/**
 * E2E Integration Tests — built-in tools, sessions, permissions, hooks.
 *
 * Requires ANTHROPIC_API_KEY (or AWS credentials for Bedrock).
 * Run: npx vitest run tests/integration/e2e-tools.test.ts
 *
 * Supports external proxy endpoints via ANTHROPIC_BASE_URL env var.
 * Tests include retry logic for transient proxy errors (500/502/503).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import path from 'path'
import {
  createAgent,
  defineTool,
  FileReadTool,
  GrepTool,
  GlobTool,
  BashTool,
} from '../../src/index.js'
import type { StreamEvent } from '../../src/types.js'

const hasApiKey = !!(
  process.env.ANTHROPIC_API_KEY ||
  process.env.AWS_ACCESS_KEY_ID ||
  process.env.AWS_PROFILE
)

const MODEL = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'

/** Shared config for API connectivity — supports direct, Bedrock, and proxy endpoints */
const apiConfig = {
  ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
  ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
  ...(!process.env.CLAUDE_CODE_USE_BEDROCK && process.env.ANTHROPIC_API_KEY && { provider: 'anthropic' as const }),
}

/** Retry for transient proxy 500/502/503 errors */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 5000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      const msg = e?.message ?? ''
      const isTransient = msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('transient')
      if (i < retries && isTransient) {
        await new Promise(r => setTimeout(r, delayMs))
        continue
      }
      throw e
    }
  }
  throw new Error('unreachable')
}

/** Assert result has text, or throw transient error for retry */
function assertHasText(result: { text: string; numTurns: number }) {
  if (!result.text && result.numTurns <= 1) {
    throw new Error('transient: empty result (likely proxy 500)')
  }
  expect(result.text).toBeTruthy()
}

// Throttle: wait between tests to avoid proxy rate limits
const THROTTLE_MS = Number(process.env.E2E_THROTTLE_MS ?? '3000')

// ─── Tests ─────────────────────────────────────────────────────────────────

describe.skipIf(!hasApiKey)('E2E: Built-in Tools', () => {
  beforeEach(async () => { await new Promise(r => setTimeout(r, THROTTLE_MS)) })
  it('Read tool — agent reads a real file and extracts info', async () => {
    await withRetry(async () => {
      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [FileReadTool],
        systemPrompt: 'Use the Read tool to answer questions. Be concise.',
        maxTurns: 5,
      })

      const pkgPath = path.resolve(process.cwd(), 'package.json')
      const result = await agent.ask(`Read ${pkgPath} and tell me the project name.`)

      assertHasText(result)
      expect(result.text.toLowerCase()).toContain('agent-core')
      expect(result.numTurns).toBeGreaterThanOrEqual(2)
    })
  }, 60_000)

  it('Grep tool — agent searches codebase for a pattern', async () => {
    await withRetry(async () => {
      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [GrepTool],
        systemPrompt: 'Use the Grep tool to search code. Report findings concisely.',
        maxTurns: 5,
      })

      const result = await agent.ask(
        `Search for "createAgent" in ${process.cwd()}/src/. How many files contain it?`
      )

      assertHasText(result)
      expect(result.numTurns).toBeGreaterThanOrEqual(2)
    })
  }, 60_000)

  it('multiple tools — agent chains Read + Grep to answer a question', async () => {
    await withRetry(async () => {
      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [FileReadTool, GrepTool, GlobTool],
        systemPrompt: 'Use tools to explore the codebase. Be concise.',
        maxTurns: 8,
      })

      const result = await agent.ask(
        `In the project at ${process.cwd()}, find all TypeScript files in src/tools/ and tell me how many built-in tools are defined.`
      )

      assertHasText(result)
      expect(result.numTurns).toBeGreaterThanOrEqual(2)
    })
  }, 120_000)

  it('Bash tool — agent runs a command and uses the output', async () => {
    await withRetry(async () => {
      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [BashTool],
        systemPrompt: 'Use the Bash tool to run commands. Be concise.',
        maxTurns: 5,
      })

      const result = await agent.ask('Run "node --version" and tell me the Node.js version.')

      assertHasText(result)
      expect(result.text).toMatch(/\d+/)
      expect(result.numTurns).toBeGreaterThanOrEqual(2)
    })
  }, 60_000)
})

describe.skipIf(!hasApiKey)('E2E: Multi-turn Session', () => {
  beforeEach(async () => { await new Promise(r => setTimeout(r, THROTTLE_MS)) })
  it('session maintains context across 3 turns with tools', async () => {
    await withRetry(async () => {
      const notes = new Map<string, string>()

      const saveNote = defineTool({
        name: 'SaveNote',
        description: 'Save a note with a key',
        input: z.object({ key: z.string(), content: z.string() }),
        async execute({ key, content }) {
          notes.set(key, content)
          return `Saved note "${key}"`
        },
      })

      const getNote = defineTool({
        name: 'GetNote',
        description: 'Retrieve a note by key',
        input: z.object({ key: z.string() }),
        async execute({ key }) {
          const note = notes.get(key)
          if (!note) return { content: `Note "${key}" not found`, isError: true }
          return note
        },
        isReadOnly: true,
      })

      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [saveNote, getNote],
        systemPrompt: 'You manage notes. Use tools to save and retrieve. Be concise.',
        maxTurns: 5,
      })

      const session = agent.session()

      const r1 = await session.send('Save a note with key "meeting" and content "Discuss SDK launch at 3pm"')
      assertHasText(r1)
      expect(notes.has('meeting')).toBe(true)

      const r2 = await session.send('What was the note I just saved?')
      assertHasText(r2)
      expect(r2.text.toLowerCase()).toContain('3pm')

      const r3 = await session.send('Based on that note, what time is the meeting?')
      assertHasText(r3)
      expect(r3.text).toContain('3')

      expect(session.history.length).toBeGreaterThan(4)
    })
  }, 120_000)
})

describe.skipIf(!hasApiKey)('E2E: Permission Control', () => {
  beforeEach(async () => { await new Promise(r => setTimeout(r, THROTTLE_MS)) })
  it('agent adapts when write tools are denied', async () => {
    await withRetry(async () => {
      const permissionLog: string[] = []

      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [FileReadTool, BashTool],
        systemPrompt: 'Use tools to complete tasks. If a tool is denied, explain what you would have done.',
        maxTurns: 5,
        canUseTool: (toolName) => {
          if (toolName === 'Read') {
            permissionLog.push(`allow:${toolName}`)
            return { behavior: 'allow' }
          }
          if (toolName === 'Bash') {
            permissionLog.push(`deny:${toolName}`)
            return { behavior: 'deny', message: 'Bash is disabled in this environment' }
          }
          return { behavior: 'allow' }
        },
      })

      const pkgPath = path.resolve(process.cwd(), 'package.json')
      const result = await agent.ask(
        `Read ${pkgPath}, then run "echo hello" with Bash. Report what happened.`
      )

      assertHasText(result)
      expect(permissionLog.some(l => l.startsWith('allow:Read'))).toBe(true)
      expect(permissionLog.some(l => l.startsWith('deny:Bash'))).toBe(true)
    })
  }, 120_000)
})

describe.skipIf(!hasApiKey)('E2E: Stop Hook', () => {
  beforeEach(async () => { await new Promise(r => setTimeout(r, THROTTLE_MS)) })
  it('onTurnEnd injects follow-up when condition not met', async () => {
    await withRetry(async () => {
      let hookCallCount = 0

      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        systemPrompt: 'Be concise. Always end your response with the word "COMPLETE".',
        maxTurns: 5,
        onTurnEnd: ({ lastResponse }) => {
          hookCallCount++
          if (!lastResponse.includes('COMPLETE') && hookCallCount === 1) {
            return { continueWith: 'You must end your response with the word "COMPLETE".' }
          }
          return {}
        },
      })

      const result = await agent.ask('Say hello.')

      assertHasText(result)
      expect(hookCallCount).toBeGreaterThanOrEqual(1)
    })
  }, 60_000)
})

describe.skipIf(!hasApiKey)('E2E: Streaming Events', () => {
  beforeEach(async () => { await new Promise(r => setTimeout(r, THROTTLE_MS)) })
  it('stream yields correct event sequence with tool use', async () => {
    await withRetry(async () => {
      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [FileReadTool],
        systemPrompt: 'Use the Read tool when asked about files. Be very concise.',
        maxTurns: 5,
      })

      const eventTypes: string[] = []
      const errors: string[] = []
      const pkgPath = path.resolve(process.cwd(), 'package.json')

      for await (const event of agent.stream(`Read ${pkgPath} and tell me the version.`)) {
        eventTypes.push(event.type)
        if (event.type === 'error') errors.push(event.error.message)
      }

      // Transient proxy error → retry
      if (errors.some(e => e.includes('500') || e.includes('502'))) {
        throw new Error(`transient: ${errors[0]}`)
      }

      expect(eventTypes[0]).toBe('turn_start')
      expect(eventTypes).toContain('tool_use')
      expect(eventTypes).toContain('tool_result')
      expect(eventTypes).toContain('turn_end')
      expect(eventTypes[eventTypes.length - 1]).toBe('result')
    })
  }, 120_000)

  it('stream text events concatenate to full response', async () => {
    await withRetry(async () => {
      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        systemPrompt: 'Reply with exactly: "hello world"',
        maxTurns: 1,
      })

      const textChunks: string[] = []
      let finalText = ''

      for await (const event of agent.stream('Say it.')) {
        if (event.type === 'text') textChunks.push(event.text)
        if (event.type === 'result') finalText = event.result.text
      }

      const streamed = textChunks.join('')
      expect(streamed).toBe(finalText)
      expect(streamed.toLowerCase()).toContain('hello')
    })
  }, 60_000)
})

describe.skipIf(!hasApiKey)('E2E: Custom Tool Composition', () => {
  beforeEach(async () => { await new Promise(r => setTimeout(r, THROTTLE_MS)) })
  it('agent uses multiple custom tools in sequence', async () => {
    await withRetry(async () => {
      const inventory = new Map<string, number>([
        ['apple', 10],
        ['banana', 5],
        ['cherry', 20],
      ])

      const checkStock = defineTool({
        name: 'CheckStock',
        description: 'Check inventory stock for an item',
        input: z.object({ item: z.string() }),
        async execute({ item }) {
          const stock = inventory.get(item.toLowerCase())
          if (stock === undefined) return { content: `Item "${item}" not found`, isError: true }
          return JSON.stringify({ item, stock })
        },
        isReadOnly: true,
        isConcurrencySafe: true,
      })

      const placeOrder = defineTool({
        name: 'PlaceOrder',
        description: 'Place an order for items (reduces stock)',
        input: z.object({
          item: z.string(),
          quantity: z.number().positive(),
        }),
        async execute({ item, quantity }) {
          const stock = inventory.get(item.toLowerCase())
          if (stock === undefined) return { content: `Item "${item}" not found`, isError: true }
          if (stock < quantity) return { content: `Insufficient stock: ${stock} available, ${quantity} requested`, isError: true }
          inventory.set(item.toLowerCase(), stock - quantity)
          return `Order placed: ${quantity}x ${item}. Remaining stock: ${stock - quantity}`
        },
      })

      const agent = createAgent({
        ...apiConfig,
        model: MODEL,
        tools: [checkStock, placeOrder],
        systemPrompt: 'You manage inventory. Check stock before placing orders. Be concise.',
        maxTurns: 8,
      })

      const result = await agent.ask('Check if we have enough apples to order 3, then place the order.')

      assertHasText(result)
      expect(inventory.get('apple')).toBe(7)
      expect(result.numTurns).toBeGreaterThanOrEqual(2)
    })
  }, 120_000)
})
