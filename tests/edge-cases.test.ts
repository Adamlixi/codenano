/**
 * edge-cases.test.ts — Test edge cases and potential issues
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createAgent, defineTool } from '../src/index.js'
import type { ModelStreamEvent } from '../src/provider.js'

// ─── Mock Setup ────────────────────────────────────────────────────────────

function makeMockEvents(contentBlocks: any[], stopReason = 'end_turn'): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = [{ type: 'message_start', messageId: 'msg_test' }]

  for (const block of contentBlocks) {
    if (block.type === 'text') {
      events.push({ type: 'text_delta', text: block.text })
    } else if (block.type === 'tool_use') {
      events.push({ type: 'tool_use_start', id: block.id, name: block.name })
      events.push({ type: 'input_json_delta', partialJson: JSON.stringify(block.input) })
      events.push({ type: 'content_block_stop', index: 0 })
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

vi.mock('../src/provider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/provider.js')>()
  return {
    ...original,
    createClient: vi.fn().mockReturnValue({}),
    callModelStreaming: (...args: any[]) => mockCallModelStreaming(...args),
    callModelStreamingWithRetry: (...args: any[]) => mockCallModelStreaming(...args),
  }
})

beforeEach(() => {
  mockCallModelStreaming = vi.fn()
})

// ─── Edge Cases ────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('handles empty tool input', async () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({}),
      execute: async () => 'ok',
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'test', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Done')
  })

  it('handles tool with undefined result', async () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({}),
      execute: async () => undefined,
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'test', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Done')
  })

  it('handles tool with null result', async () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({}),
      execute: async () => null,
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'test', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Done')
  })

  it('handles very large tool output', async () => {
    const largeOutput = 'x'.repeat(100000)
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({}),
      execute: async () => largeOutput,
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'test', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Done')
  })

  it('handles tool throwing error', async () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({}),
      execute: async () => {
        throw new Error('Tool failed')
      },
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'test', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Handled error' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Handled error')
  })

  it('handles unknown tool name', async () => {
    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'unknown', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Done')
  })

  it('handles invalid tool input schema', async () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({ required: z.string() }),
      execute: async () => 'ok',
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'test', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Done')
  })
})