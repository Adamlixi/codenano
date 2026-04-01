/**
 * integration-scenarios.test.ts — Test complex integration scenarios
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createAgent, defineTool } from '../src/index.js'
import type { ModelStreamEvent } from '../src/provider.js'

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

describe('Integration Scenarios', () => {
  it('handles multiple concurrent tool calls', async () => {
    const tool1 = defineTool({
      name: 'tool1',
      description: 'test',
      input: z.object({}),
      execute: async () => 'result1',
      concurrencySafe: true,
    })

    const tool2 = defineTool({
      name: 'tool2',
      description: 'test',
      input: z.object({}),
      execute: async () => 'result2',
      concurrencySafe: true,
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([
          { type: 'tool_use', id: 'tool_1', name: 'tool1', input: {} },
          { type: 'tool_use', id: 'tool_2', name: 'tool2', input: {} },
        ])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool1, tool2] })
    const result = await agent.ask('test')

    expect(result.text).toBe('Done')
    expect(result.numTurns).toBe(2)
  })

  it('handles session with multiple turns', async () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({ value: z.string() }),
      execute: async ({ value }) => `Got: ${value}`,
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'First response' }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Second response' }])
      })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })
    const session = agent.session()

    const result1 = await session.send('First message')
    expect(result1.text).toBe('First response')

    const result2 = await session.send('Second message')
    expect(result2.text).toBe('Second response')
  })

  it('handles abort during tool execution', async () => {
    const tool = defineTool({
      name: 'slow',
      description: 'test',
      input: z.object({}),
      execute: async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'done'
      },
    })

    mockCallModelStreaming.mockImplementationOnce(async function* () {
      yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'slow', input: {} }])
    })

    const agent = createAgent({ model: 'test', apiKey: 'test', tools: [tool] })

    const promise = agent.ask('test')
    setTimeout(() => agent.abort(), 10)

    const result = await promise
    expect(result.stopReason).toContain('turn')
  })

  it('handles max_tokens with escalation', async () => {
    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Partial' }], 'max_tokens')
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Complete' }])
      })

    const agent = createAgent({
      model: 'test',
      apiKey: 'test',
      maxOutputTokensCap: true,
    })
    const result = await agent.ask('test')

    expect(result.text).toContain('Complete')
  })

  it('handles streaming tool execution', async () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      input: z.object({}),
      execute: async () => 'result',
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'test', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({
      model: 'test',
      apiKey: 'test',
      tools: [tool],
      streamingToolExecution: true,
    })

    const events = []
    for await (const event of agent.stream('test')) {
      events.push(event)
    }

    expect(events.some(e => e.type === 'tool_result')).toBe(true)
  })

  it('handles tool result budgeting', async () => {
    const largeTool = defineTool({
      name: 'large',
      description: 'test',
      input: z.object({}),
      execute: async () => 'x'.repeat(100000),
    })

    mockCallModelStreaming
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'tool_use', id: 'tool_1', name: 'large', input: {} }])
      })
      .mockImplementationOnce(async function* () {
        yield* makeMockEvents([{ type: 'text', text: 'Done' }])
      })

    const agent = createAgent({
      model: 'test',
      apiKey: 'test',
      tools: [largeTool],
      toolResultBudget: true,
    })

    const result = await agent.ask('test')
    expect(result.text).toBe('Done')
  })
})
