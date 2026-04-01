/**
 * agent-loop.test.ts — Comprehensive agent loop tests with mocked provider
 *
 * Covers: ask(), stream(), session.send(), tool execution, permission denial,
 * tool errors, max turns, stop hooks, and prompt system integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createAgent, defineTool } from '../src/index.js'
import type { StreamEvent } from '../src/types.js'
import type { ModelStreamEvent } from '../src/provider.js'

// ─── Mock Setup ────────────────────────────────────────────────────────────

/**
 * Generate ModelStreamEvents that callModelStreaming would yield.
 * Mocks at the provider level so we skip the real Anthropic SDK entirely.
 */
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

/** Configure mock to yield events for one turn */
function mockTurn(contentBlocks: any[], stopReason = 'end_turn') {
  const events = makeMockEvents(contentBlocks, stopReason)
  mockCallModelStreaming.mockImplementationOnce(async function* () {
    for (const event of events) yield event
  })
}

/** Configure mock to always yield the same events (for maxTurns tests) */
function mockTurnForever(contentBlocks: any[], stopReason = 'end_turn') {
  const events = makeMockEvents(contentBlocks, stopReason)
  mockCallModelStreaming.mockImplementation(async function* () {
    for (const event of events) yield event
  })
}

// ─── ask() ─────────────────────────────────────────────────────────────────

describe('Agent.ask()', () => {
  it('returns text result for simple response', async () => {
    mockTurn([{ type: 'text', text: 'Hello world' }])

    const agent = createAgent({ model: 'test-model', apiKey: 'test' })
    const result = await agent.ask('Hi')

    expect(result.text).toBe('Hello world')
    expect(result.stopReason).toBe('end_turn')
    expect(result.numTurns).toBe(1)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.messages).toHaveLength(2) // user + assistant
  })

  it('executes tool and continues the loop', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Echo', input: { text: 'ping' } }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Tool said: echo: ping' }])

    const echo = defineTool({
      name: 'Echo',
      description: 'Echo input',
      input: z.object({ text: z.string() }),
      execute: async ({ text }) => `echo: ${text}`,
    })

    const agent = createAgent({ model: 'test', apiKey: 'k', tools: [echo] })
    const result = await agent.ask('Echo ping')

    expect(result.text).toBe('Tool said: echo: ping')
    expect(result.numTurns).toBe(2)
    expect(mockCallModelStreaming).toHaveBeenCalledTimes(2)
  })

  it('handles unknown tool gracefully', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'NonExistent', input: {} }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Sorry, tool not found' }])

    const agent = createAgent({ model: 'test', apiKey: 'k' })
    const result = await agent.ask('Use NonExistent')

    expect(result.text).toBe('Sorry, tool not found')
    expect(result.numTurns).toBe(2)
  })

  it('handles tool validation error', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Strict', input: { value: 123 } }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Fixed' }])

    const strict = defineTool({
      name: 'Strict',
      description: 'Requires string',
      input: z.object({ value: z.string() }),
      execute: async () => 'ok',
    })

    const agent = createAgent({ model: 'test', apiKey: 'k', tools: [strict] })
    const result = await agent.ask('Call strict with number')

    expect(result.text).toBe('Fixed')
    expect(result.numTurns).toBe(2)
  })

  it('handles tool execution error', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Failing', input: {} }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Handled error' }])

    const failing = defineTool({
      name: 'Failing',
      description: 'Always fails',
      input: z.object({}),
      execute: async () => { throw new Error('Boom!') },
    })

    const agent = createAgent({ model: 'test', apiKey: 'k', tools: [failing] })
    const result = await agent.ask('Call failing')

    expect(result.text).toBe('Handled error')
  })

  it('respects permission denial', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Delete', input: { path: '/etc' } }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Permission was denied' }])

    const deleteTool = defineTool({
      name: 'Delete',
      description: 'Delete',
      input: z.object({ path: z.string() }),
      execute: async () => 'deleted',
    })

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      tools: [deleteTool],
      canUseTool: (name) => {
        if (name === 'Delete') return { behavior: 'deny', message: 'Not allowed' }
        return { behavior: 'allow' }
      },
    })

    const result = await agent.ask('Delete /etc')
    expect(result.text).toBe('Permission was denied')
  })

  it('stops at maxTurns', async () => {
    mockTurnForever(
      [{ type: 'tool_use', id: 'tu_1', name: 'Loop', input: {} }],
      'tool_use',
    )

    const loopTool = defineTool({
      name: 'Loop',
      description: 'Loop forever',
      input: z.object({}),
      execute: async () => 'again',
    })

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      tools: [loopTool],
      maxTurns: 3,
    })

    const result = await agent.ask('Loop')

    expect(result.numTurns).toBe(3)
    expect(result.stopReason).toContain('max_turns')
  })

  it('uses stop hook to continue', async () => {
    mockTurn([{ type: 'text', text: 'First response' }])
    mockTurn([{ type: 'text', text: 'After hook' }])

    let hookCalled = false
    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      onTurnEnd: () => {
        if (!hookCalled) {
          hookCalled = true
          return { continueWith: 'Continue please' }
        }
        return {}
      },
    })

    const result = await agent.ask('Start')

    expect(result.text).toBe('After hook')
    expect(result.numTurns).toBe(2)
    expect(hookCalled).toBe(true)
  })
})

// ─── stream() ──────────────────────────────────────────────────────────────

describe('Agent.stream()', () => {
  it('yields text events followed by result', async () => {
    mockTurn([{ type: 'text', text: 'Streamed output' }])

    const agent = createAgent({ model: 'test', apiKey: 'k' })
    const events: StreamEvent[] = []
    for await (const event of agent.stream('Hello')) {
      events.push(event)
    }

    const textEvents = events.filter(e => e.type === 'text')
    expect(textEvents.length).toBeGreaterThan(0)
    expect(textEvents[0]).toEqual({ type: 'text', text: 'Streamed output' })

    const resultEvent = events.find(e => e.type === 'result')
    expect(resultEvent).toBeDefined()
    if (resultEvent?.type === 'result') {
      expect(resultEvent.result.text).toBe('Streamed output')
    }
  })

  it('yields tool_use and tool_result events', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Ping', input: {} }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Done' }])

    const ping = defineTool({
      name: 'Ping',
      description: 'Ping',
      input: z.object({}),
      execute: async () => 'pong',
    })

    const agent = createAgent({ model: 'test', apiKey: 'k', tools: [ping] })
    const events: StreamEvent[] = []
    for await (const event of agent.stream('Ping')) {
      events.push(event)
    }

    const toolUseEvents = events.filter(e => e.type === 'tool_use')
    expect(toolUseEvents.length).toBeGreaterThan(0)

    const toolResultEvents = events.filter(e => e.type === 'tool_result')
    expect(toolResultEvents.length).toBeGreaterThan(0)
    if (toolResultEvents[0]?.type === 'tool_result') {
      expect(toolResultEvents[0].output).toBe('pong')
      expect(toolResultEvents[0].isError).toBe(false)
    }
  })

  it('yields turn_start and turn_end events', async () => {
    mockTurn([{ type: 'text', text: 'Hi' }])

    const agent = createAgent({ model: 'test', apiKey: 'k' })
    const events: StreamEvent[] = []
    for await (const event of agent.stream('Hey')) {
      events.push(event)
    }

    const turnStarts = events.filter(e => e.type === 'turn_start')
    const turnEnds = events.filter(e => e.type === 'turn_end')
    expect(turnStarts.length).toBeGreaterThanOrEqual(1)
    expect(turnEnds.length).toBeGreaterThanOrEqual(1)
  })

  it('yields error tool_result for execution failure', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Bomb', input: {} }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Recovered' }])

    const bomb = defineTool({
      name: 'Bomb',
      description: 'Explodes',
      input: z.object({}),
      execute: async () => { throw new Error('kaboom') },
    })

    const agent = createAgent({ model: 'test', apiKey: 'k', tools: [bomb] })
    const events: StreamEvent[] = []
    for await (const event of agent.stream('Boom')) {
      events.push(event)
    }

    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults.length).toBeGreaterThan(0)
    if (toolResults[0]?.type === 'tool_result') {
      expect(toolResults[0].isError).toBe(true)
      expect(toolResults[0].output).toContain('kaboom')
    }
  })
})

// ─── Session ───────────────────────────────────────────────────────────────

describe('Session', () => {
  it('accumulates history across sends', async () => {
    mockTurn([{ type: 'text', text: 'Response 1' }])
    mockTurn([{ type: 'text', text: 'Response 2' }])

    const agent = createAgent({ model: 'test', apiKey: 'k' })
    const session = agent.session()

    expect(session.history).toHaveLength(0)

    await session.send('First message')
    expect(session.history.length).toBeGreaterThanOrEqual(2)

    await session.send('Second message')
    expect(session.history.length).toBeGreaterThanOrEqual(4)
  })

  it('session.stream() yields events', async () => {
    mockTurn([{ type: 'text', text: 'Streamed' }])

    const agent = createAgent({ model: 'test', apiKey: 'k' })
    const session = agent.session()
    const events: StreamEvent[] = []
    for await (const event of session.stream('Hello')) {
      events.push(event)
    }

    expect(events.some(e => e.type === 'text')).toBe(true)
    expect(events.some(e => e.type === 'result')).toBe(true)
  })

  it('session handles tool use across turns', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Get', input: { key: 'name' } }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Got: Alice' }])

    const get = defineTool({
      name: 'Get',
      description: 'Get value',
      input: z.object({ key: z.string() }),
      execute: async ({ key }) => key === 'name' ? 'Alice' : 'unknown',
    })

    const agent = createAgent({ model: 'test', apiKey: 'k', tools: [get] })
    const session = agent.session()
    const result = await session.send('Get name')

    expect(result.text).toBe('Got: Alice')
    expect(result.numTurns).toBe(2)
  })

  it('session respects maxTurns', async () => {
    mockTurnForever(
      [{ type: 'tool_use', id: 'tu_1', name: 'Loop', input: {} }],
      'tool_use',
    )

    const loopTool = defineTool({
      name: 'Loop',
      description: 'Loop',
      input: z.object({}),
      execute: async () => 'again',
    })

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      tools: [loopTool],
      maxTurns: 2,
    })
    const session = agent.session()
    const result = await session.send('Loop')

    expect(result.numTurns).toBe(2)
    expect(result.stopReason).toContain('max_turns')
  })

  it('session handles permission denial', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Danger', input: {} }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'Denied OK' }])

    const danger = defineTool({
      name: 'Danger',
      description: 'Dangerous',
      input: z.object({}),
      execute: async () => 'bad',
    })

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      tools: [danger],
      canUseTool: () => ({ behavior: 'deny', message: 'Nope' }),
    })
    const session = agent.session()
    const result = await session.send('Do danger')

    expect(result.text).toBe('Denied OK')
  })

  it('session stop hook continues loop', async () => {
    mockTurn([{ type: 'text', text: 'First' }])
    mockTurn([{ type: 'text', text: 'After hook' }])

    let hookCount = 0
    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      onTurnEnd: () => {
        hookCount++
        if (hookCount === 1) return { continueWith: 'Keep going' }
        return {}
      },
    })

    const session = agent.session()
    const result = await session.send('Start')

    expect(result.text).toBe('After hook')
    expect(hookCount).toBe(2)
  })
})

// ─── Max Output Escalation ────────────────────────────────────────────────

describe('Max Output Escalation', () => {
  it('escalates from 8k to 64k on max_tokens (cap enabled)', async () => {
    // First call: max_tokens with 8k cap
    mockTurn([{ type: 'text', text: 'Partial output...' }], 'max_tokens')
    // Second call: succeeds at 64k
    mockTurn([{ type: 'text', text: 'Complete output' }])

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      maxOutputTokensCap: true,
      maxOutputRecoveryAttempts: 3,
    })
    const result = await agent.ask('Generate long output')

    expect(result.text).toBe('Complete output')
    // Escalation retries with same messages (no recovery text), so 2 calls total
    expect(mockCallModelStreaming).toHaveBeenCalledTimes(2)
    // No recovery message should be present in messages
    const hasRecoveryMessage = result.messages.some(
      (m: any) => typeof m.content === 'string' && m.content.includes('Output token limit hit'),
    )
    expect(hasRecoveryMessage).toBe(false)
  })

  it('falls back to recovery inject after escalation fails', async () => {
    // First call: max_tokens at 8k
    mockTurn([{ type: 'text', text: 'Partial 1' }], 'max_tokens')
    // Second call: max_tokens at 64k (escalation also hit limit)
    mockTurn([{ type: 'text', text: 'Partial 2' }], 'max_tokens')
    // Third call: recovery inject succeeds
    mockTurn([{ type: 'text', text: 'Resumed output' }])

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      maxOutputTokensCap: true,
      maxOutputRecoveryAttempts: 3,
    })
    const result = await agent.ask('Generate very long output')

    expect(result.text).toBe('Resumed output')
    expect(mockCallModelStreaming).toHaveBeenCalledTimes(3)
  })

  it('skips escalation when cap is disabled (recovery only)', async () => {
    // max_tokens with cap disabled — go straight to recovery
    mockTurn([{ type: 'text', text: 'Partial' }], 'max_tokens')
    mockTurn([{ type: 'text', text: 'Resumed' }])

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      maxOutputTokensCap: false,
      maxOutputRecoveryAttempts: 3,
    })
    const result = await agent.ask('Long output')

    expect(result.text).toBe('Resumed')
    // No escalation — second call should NOT have override
    const secondCallArgs = mockCallModelStreaming.mock.calls[1]!
    const override = secondCallArgs[6]
    expect(override).toBeUndefined()
  })

  it('resets cap after successful tool execution', async () => {
    // First call: tool_use (resets cap)
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Echo', input: { text: 'hi' } }],
      'tool_use',
    )
    // Second call: max_tokens (should start from 8k again → escalation)
    mockTurn([{ type: 'text', text: 'Partial' }], 'max_tokens')
    // Third call: escalated to 64k → succeeds
    mockTurn([{ type: 'text', text: 'Done' }])

    const echo = defineTool({
      name: 'Echo',
      description: 'Echo',
      input: z.object({ text: z.string() }),
      execute: async ({ text }) => text,
    })

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      tools: [echo],
      maxOutputTokensCap: true,
      streamingToolExecution: false,
    })
    const result = await agent.ask('Do stuff')

    expect(result.text).toBe('Done')
    // 3 model calls: tool_use, max_tokens (escalation retry), success
    expect(mockCallModelStreaming).toHaveBeenCalledTimes(3)
    // Escalation retries with same messages — no recovery inject
    // Final messages: user + assistant(tool_use) + user(tool_result) + assistant
    expect(result.messages.length).toBeGreaterThanOrEqual(4)
  })
})

// ─── Streaming Tool Execution Integration ─────────────────────────────────

describe('Streaming Tool Execution', () => {
  it('executes tools via streaming executor (default)', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: '/test' } }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'File content: hello' }])

    const read = defineTool({
      name: 'Read',
      description: 'Read file',
      input: z.object({ path: z.string() }),
      execute: async ({ path }) => `content of ${path}`,
    })

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      tools: [read],
      // streamingToolExecution: true (default)
    })
    const result = await agent.ask('Read /test')

    expect(result.text).toBe('File content: hello')
    expect(result.numTurns).toBe(2)
  })

  it('falls back to batch execution when disabled', async () => {
    mockTurn(
      [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: '/test' } }],
      'tool_use',
    )
    mockTurn([{ type: 'text', text: 'File content: hello' }])

    const read = defineTool({
      name: 'Read',
      description: 'Read file',
      input: z.object({ path: z.string() }),
      execute: async ({ path }) => `content of ${path}`,
    })

    const agent = createAgent({
      model: 'test',
      apiKey: 'k',
      tools: [read],
      streamingToolExecution: false,
    })
    const result = await agent.ask('Read /test')

    expect(result.text).toBe('File content: hello')
    expect(result.numTurns).toBe(2)
  })
})

// ─── Prompt Integration ────────────────────────────────────────────────────

import { clearSections } from '../src/prompt/index.js'

describe('Prompt system integration', () => {
  beforeEach(() => {
    clearSections()
  })

  it('uses built prompt when no systemPrompt provided', async () => {
    mockTurn([{ type: 'text', text: 'ok' }])

    const agent = createAgent({ model: 'test-model', apiKey: 'k' })
    await agent.ask('Hi')

    // callModelStreaming receives: (client, messages, systemPrompt, tools, config, signal)
    const systemPromptArg = mockCallModelStreaming.mock.calls[0]![2] as string
    expect(systemPromptArg.length).toBeGreaterThan(0)
    expect(systemPromptArg).toContain('interactive agent')
  })

  it('uses custom systemPrompt when provided', async () => {
    mockTurn([{ type: 'text', text: 'ok' }])

    const agent = createAgent({
      model: 'test-model',
      apiKey: 'k',
      systemPrompt: 'You are a custom bot.',
    })
    await agent.ask('Hi')

    const systemPromptArg = mockCallModelStreaming.mock.calls[0]![2] as string
    expect(systemPromptArg).toContain('custom bot')
  })

  it('uses overrideSystemPrompt when provided', async () => {
    mockTurn([{ type: 'text', text: 'ok' }])

    const agent = createAgent({
      model: 'test-model',
      apiKey: 'k',
      systemPrompt: 'Custom',
      overrideSystemPrompt: 'Override only',
    })
    await agent.ask('Hi')

    const systemPromptArg = mockCallModelStreaming.mock.calls[0]![2] as string
    expect(systemPromptArg).toBe('Override only')
  })

  it('appends appendSystemPrompt', async () => {
    mockTurn([{ type: 'text', text: 'ok' }])

    const agent = createAgent({
      model: 'test-model',
      apiKey: 'k',
      appendSystemPrompt: 'ALWAYS_APPENDED',
    })
    await agent.ask('Hi')

    const systemPromptArg = mockCallModelStreaming.mock.calls[0]![2] as string
    expect(systemPromptArg).toContain('ALWAYS_APPENDED')
  })

  it('includes language in prompt', async () => {
    mockTurn([{ type: 'text', text: 'ok' }])

    const agent = createAgent({
      model: 'test-model',
      apiKey: 'k',
      language: 'Japanese',
    })
    await agent.ask('Hi')

    const systemPromptArg = mockCallModelStreaming.mock.calls[0]![2] as string
    expect(systemPromptArg).toContain('Japanese')
  })

  it('includes custom identity', async () => {
    mockTurn([{ type: 'text', text: 'ok' }])

    const agent = createAgent({
      model: 'test-model',
      apiKey: 'k',
      identity: 'You are a security auditor.',
    })
    await agent.ask('Hi')

    const systemPromptArg = mockCallModelStreaming.mock.calls[0]![2] as string
    expect(systemPromptArg).toContain('security auditor')
  })
})
