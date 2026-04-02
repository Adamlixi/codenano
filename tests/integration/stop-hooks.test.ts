/**
 * E2E tests for Stop Hooks
 * Run: npm run test:integration
 */

import { describe, it, expect } from 'vitest'
import { createAgent } from '../../src/index.js'

describe('Stop Hooks E2E', () => {
  const config = {
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
  }

  it('should enforce response format with continueWith', async () => {
    let hookCalled = false
    const agent = createAgent({
      ...config,
      maxTurns: 5,
      onTurnEnd: ({ lastResponse }) => {
        if (!lastResponse.includes('DONE') && !hookCalled) {
          hookCalled = true
          return { continueWith: 'Please end with "DONE"' }
        }
        return {}
      },
    })

    const result = await agent.ask('Say hello')
    expect(result.text).toContain('DONE')
    expect(hookCalled).toBe(true)
  })

  it('should stop immediately with preventContinuation', async () => {
    const agent = createAgent({
      ...config,
      maxTurns: 5,
      onTurnEnd: () => ({ preventContinuation: true }),
    })

    const result = await agent.ask('Count to 10')
    expect(result.stopReason).toBe('stop_hook_prevented')
    expect(result.numTurns).toBe(1)
  })

  it('should hit retry limit and stop', async () => {
    let retryCount = 0
    const agent = createAgent({
      ...config,
      maxTurns: 10,
      onTurnEnd: () => {
        retryCount++
        return { continueWith: 'Add "MARKER" to response' }
      },
    })

    const result = await agent.ask('Say hello')
    expect(result.stopReason).toBe('hook_retry_limit')
    expect(retryCount).toBe(4) // Initial + 3 retries
  })

  it('should work with session', async () => {
    const agent = createAgent({
      ...config,
      maxTurns: 5,
      onTurnEnd: ({ lastResponse }) => {
        if (lastResponse.includes('stop')) {
          return { preventContinuation: true }
        }
        return {}
      },
    })

    const session = agent.session()
    const result = await session.send('Say "stop"')
    expect(result.stopReason).toBe('stop_hook_prevented')
  })
})
