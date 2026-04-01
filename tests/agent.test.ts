import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createAgent, defineTool } from '../src/index.js'
import type { StreamEvent } from '../src/types.js'

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: vi.fn(),
        create: vi.fn(),
      }
    },
  }
})

describe('createAgent', () => {
  it('creates an agent with default config', () => {
    const agent = createAgent({
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
    })

    expect(agent).toBeDefined()
    expect(typeof agent.ask).toBe('function')
    expect(typeof agent.stream).toBe('function')
    expect(typeof agent.session).toBe('function')
    expect(typeof agent.abort).toBe('function')
  })

  it('creates an agent with tools', () => {
    const tool = defineTool({
      name: 'TestTool',
      description: 'A test tool',
      input: z.object({ value: z.string() }),
      execute: async ({ value }) => `echo: ${value}`,
    })

    const agent = createAgent({
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
      tools: [tool],
      systemPrompt: 'You are a test agent.',
      maxTurns: 5,
    })

    expect(agent).toBeDefined()
  })

  it('creates a session', () => {
    const agent = createAgent({
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
    })

    const session = agent.session()
    expect(session).toBeDefined()
    expect(typeof session.send).toBe('function')
    expect(typeof session.stream).toBe('function')
    expect(typeof session.abort).toBe('function')
    expect(session.history).toEqual([])
  })
})

describe('StreamEvent types', () => {
  it('covers all event types', () => {
    const events: StreamEvent[] = [
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'reasoning...' },
      { type: 'tool_use', toolName: 'Read', toolUseId: '123', input: {} },
      { type: 'tool_result', toolUseId: '123', output: 'data', isError: false },
      { type: 'turn_start', turnNumber: 1 },
      { type: 'turn_end', stopReason: 'end_turn', turnNumber: 1 },
      { type: 'result', result: {
        text: 'done',
        messages: [],
        usage: { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        stopReason: 'end_turn',
        numTurns: 1,
        durationMs: 1000,
      }},
      { type: 'error', error: new Error('oops') },
    ]

    expect(events).toHaveLength(8)
    expect(events[0]!.type).toBe('text')
    expect(events[7]!.type).toBe('error')
  })
})
