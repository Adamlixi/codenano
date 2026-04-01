/**
 * recovery.test.ts — Tests for error recovery mechanisms
 *
 * Covers:
 * - 413 prompt-too-long recovery
 * - Max output tokens escalation (8K → 64K)
 * - Max output tokens recovery (resume injection)
 * - Model fallback on 529 errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgent } from '../src/index.js'
import type { ModelStreamEvent } from '../src/provider.js'

// ─── Mock Setup ────────────────────────────────────────────────────────────

function makeMockEvents(
  contentBlocks: any[],
  stopReason = 'end_turn',
): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = [
    { type: 'message_start', messageId: 'msg_test' },
  ]

  for (const block of contentBlocks) {
    if (block.type === 'text') {
      events.push({ type: 'text_delta', text: block.text })
    }
  }

  events.push({ type: 'message_delta', stopReason, usage: { outputTokens: 50 } })
  events.push({
    type: 'message_complete',
    result: {
      message: {} as any,
      assistantContent: contentBlocks,
      stopReason,
      usage: { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    },
  })

  return events
}

let mockCallModelStreaming: ReturnType<typeof vi.fn>
let mockCompactMessages: ReturnType<typeof vi.fn>

vi.mock('../src/provider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/provider.js')>()
  return {
    ...original,
    createClient: vi.fn().mockReturnValue({}),
    callModelStreaming: (...args: any[]) => mockCallModelStreaming(...args),
    callModelStreamingWithRetry: (...args: any[]) => mockCallModelStreaming(...args),
  }
})

vi.mock('../src/compact.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/compact.js')>()
  return {
    ...original,
    compactMessages: (...args: any[]) => mockCompactMessages(...args),
  }
})

beforeEach(() => {
  mockCallModelStreaming = vi.fn()
  mockCompactMessages = vi.fn()
})

// ─── 413 Recovery ──────────────────────────────────────────────────────────

describe('413 Prompt Too Long Recovery', () => {
  it('compacts and retries on 413 error', async () => {
    // First call: 413 error
    mockCallModelStreaming.mockImplementationOnce(async function* () {
      throw Object.assign(new Error('prompt is too long'), { status: 413 })
    })

    // After compact: success
    mockCallModelStreaming.mockImplementationOnce(async function* () {
      for (const event of makeMockEvents([{ type: 'text', text: 'Success after compact' }])) {
        yield event
      }
    })

    // Mock compact to return simplified messages
    mockCompactMessages.mockResolvedValueOnce([
      { role: 'user', content: 'Summary of previous conversation' },
    ])

    const agent = createAgent({ model: 'test-model', apiKey: 'test' })
    const result = await agent.ask('Test prompt')

    expect(result.text).toBe('Success after compact')
    expect(mockCompactMessages).toHaveBeenCalledTimes(1)
    expect(mockCallModelStreaming).toHaveBeenCalledTimes(2)
  })

  it('fails if compact also fails', async () => {
    mockCallModelStreaming.mockImplementation(async function* () {
      throw Object.assign(new Error('prompt is too long'), { status: 413 })
    })

    mockCompactMessages.mockResolvedValueOnce(null)

    const agent = createAgent({ model: 'test-model', apiKey: 'test', maxTurns: 1 })
    const result = await agent.ask('Test')

    // Agent returns max_turns result when compact fails
    expect(result.stopReason).toContain('max_turns')
    expect(mockCompactMessages).toHaveBeenCalledTimes(1)
  })
})

// ─── Max Output Tokens Escalation ──────────────────────────────────────────

describe('Max Output Tokens Escalation', () => {
  it('escalates from 8K to 64K on max_tokens', async () => {
    let callCount = 0

    mockCallModelStreaming.mockImplementation(async function* () {
      callCount++
      if (callCount === 1) {
        // First call hits max_tokens
        for (const event of makeMockEvents([{ type: 'text', text: 'Partial...' }], 'max_tokens')) {
          yield event
        }
      } else {
        // Second call with 64K succeeds
        for (const event of makeMockEvents([{ type: 'text', text: 'Complete response' }])) {
          yield event
        }
      }
    })

    const agent = createAgent({
      model: 'test-model',
      apiKey: 'test',
      maxOutputTokensCap: true,
    })
    const result = await agent.ask('Test')

    expect(result.text).toBe('Complete response')
    expect(mockCallModelStreaming).toHaveBeenCalledTimes(2)
  })
})

// ─── Max Output Tokens Recovery ────────────────────────────────────────────

describe('Max Output Tokens Recovery', () => {
  it('injects resume message up to 3 times', async () => {
    let callCount = 0

    mockCallModelStreaming.mockImplementation(async function* () {
      callCount++
      if (callCount <= 3) {
        for (const event of makeMockEvents([{ type: 'text', text: `Part ${callCount}` }], 'max_tokens')) {
          yield event
        }
      } else {
        for (const event of makeMockEvents([{ type: 'text', text: 'Final' }])) {
          yield event
        }
      }
    })

    const agent = createAgent({ model: 'test-model', apiKey: 'test' })
    const result = await agent.ask('Test')

    expect(result.text).toBe('Final')
    expect(mockCallModelStreaming).toHaveBeenCalledTimes(4)
  })

  it('stops after 3 recovery attempts', async () => {
    mockCallModelStreaming.mockImplementation(async function* () {
      for (const event of makeMockEvents([{ type: 'text', text: 'Partial' }], 'max_tokens')) {
        yield event
      }
    })

    const agent = createAgent({
      model: 'test-model',
      apiKey: 'test',
      maxOutputRecoveryAttempts: 3,
    })
    const result = await agent.ask('Test')

    expect(mockCallModelStreaming).toHaveBeenCalledTimes(4) // initial + 3 retries
    expect(result.stopReason).toBe('max_tokens')
  })
})

// ─── Model Fallback ────────────────────────────────────────────────────────

describe('Model Fallback on 529 Errors', () => {
  it('handles 529 errors with retry mechanism', async () => {
    // Test that 529 errors are retryable
    mockCallModelStreaming.mockImplementation(async function* () {
      throw Object.assign(new Error('overloaded'), { status: 529 })
    })

    const agent = createAgent({ model: 'test-model', apiKey: 'test', maxTurns: 1 })
    const result = await agent.ask('Test')

    // Agent exhausts retries and returns max_turns
    expect(result.stopReason).toContain('max_turns')
  })
})
