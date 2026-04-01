/**
 * Integration test — runs against real Claude API.
 *
 * Requires ANTHROPIC_API_KEY (or AWS credentials for Bedrock).
 * Run: npx vitest run tests/integration/live-agent.test.ts
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createAgent, defineTool } from '../../src/index.js'
import type { StreamEvent } from '../../src/types.js'

const hasApiKey = !!(
  process.env.ANTHROPIC_API_KEY ||
  process.env.AWS_ACCESS_KEY_ID ||
  process.env.AWS_PROFILE
)

// Use the model from env or default
const MODEL = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'

/** Shared config for API connectivity — supports direct, Bedrock, and proxy endpoints */
const apiConfig = {
  ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
  ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
  ...(!process.env.CLAUDE_CODE_USE_BEDROCK && process.env.ANTHROPIC_API_KEY && { provider: 'anthropic' as const }),
}

describe.skipIf(!hasApiKey)('Live Agent Integration', () => {
  it('basic ask — no tools', async () => {
    const agent = createAgent({
      ...apiConfig,
      model: MODEL,
      systemPrompt: 'Reply with exactly one word.',
      maxTurns: 1,
    })

    const result = await agent.ask('Say "hello"')

    expect(result.text).toBeTruthy()
    expect(result.text.toLowerCase()).toContain('hello')
    expect(result.numTurns).toBe(1)
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThan(0)
  }, 30_000)

  it('streaming — yields text events', async () => {
    const agent = createAgent({
      ...apiConfig,
      model: MODEL,
      systemPrompt: 'Reply with exactly: "streaming works"',
      maxTurns: 1,
    })

    const events: StreamEvent[] = []
    for await (const event of agent.stream('Test streaming')) {
      events.push(event)
    }

    const textEvents = events.filter(e => e.type === 'text')
    expect(textEvents.length).toBeGreaterThan(0)

    const resultEvent = events.find(e => e.type === 'result')
    expect(resultEvent).toBeDefined()
    if (resultEvent?.type === 'result') {
      expect(resultEvent.result.text).toBeTruthy()
    }
  }, 30_000)

  it('tool use — agent calls a tool and uses the result', async () => {
    const getWeather = defineTool({
      name: 'GetWeather',
      description: 'Get current weather for a city',
      input: z.object({
        city: z.string().describe('City name'),
      }),
      execute: async ({ city }) => {
        return JSON.stringify({ city, temperature: 22, condition: 'sunny' })
      },
      isReadOnly: true,
    })

    const agent = createAgent({
      ...apiConfig,
      model: MODEL,
      tools: [getWeather],
      systemPrompt: 'You are a weather assistant. Use the GetWeather tool to answer weather questions.',
      maxTurns: 5,
    })

    const result = await agent.ask('What is the weather in Tokyo?')

    expect(result.text).toBeTruthy()
    // Agent should have used the tool and mentioned the result
    expect(result.numTurns).toBeGreaterThanOrEqual(2)
    // The response should mention something about the weather data
    const lowerText = result.text.toLowerCase()
    expect(
      lowerText.includes('tokyo') ||
      lowerText.includes('22') ||
      lowerText.includes('sunny')
    ).toBe(true)
  }, 60_000)

  it('multi-turn session — remembers context', async () => {
    const agent = createAgent({
      ...apiConfig,
      model: MODEL,
      systemPrompt: 'Be concise. One sentence answers.',
      maxTurns: 3,
    })

    const session = agent.session()

    const r1 = await session.send('My favorite color is blue. Remember that.')
    expect(r1.text).toBeTruthy()

    const r2 = await session.send('What is my favorite color?')
    expect(r2.text.toLowerCase()).toContain('blue')

    // Session should have accumulated history
    expect(session.history.length).toBeGreaterThan(2)
  }, 60_000)

  it('permission denial — canUseTool callback', async () => {
    const dangerousTool = defineTool({
      name: 'DeleteFile',
      description: 'Delete a file',
      input: z.object({ path: z.string() }),
      execute: async () => 'deleted',
    })

    const agent = createAgent({
      ...apiConfig,
      model: MODEL,
      tools: [dangerousTool],
      systemPrompt: 'Use DeleteFile to delete /tmp/test.txt when asked to delete files.',
      maxTurns: 5,
      canUseTool: (toolName) => {
        if (toolName === 'DeleteFile') {
          return { behavior: 'deny', message: 'File deletion is not allowed' }
        }
        return { behavior: 'allow' }
      },
    })

    const result = await agent.ask('Delete the file /tmp/test.txt')
    // Agent should acknowledge the permission denial
    expect(result.text).toBeTruthy()
  }, 30_000)
})
