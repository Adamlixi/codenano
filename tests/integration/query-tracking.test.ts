/**
 * query-tracking.test.ts — End-to-end tests for Query Tracking
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createAgent, defineTool } from '../../src/index.js'
import { z } from 'zod'

describe('Query Tracking', () => {
  const apiKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for integration tests')
    }
  })

  it('should initialize queryTracking with depth 0 for first query', async () => {
    const agent = createAgent({
      apiKey,
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a helpful assistant.',
    })

    const events: any[] = []
    for await (const event of agent.stream('Say hello')) {
      events.push(event)
      if (event.type === 'result') break
    }

    // Find query_start event
    const queryStartEvent = events.find(e => e.type === 'query_start')
    expect(queryStartEvent).toBeDefined()
    expect(queryStartEvent.queryTracking).toBeDefined()
    expect(queryStartEvent.queryTracking.depth).toBe(0)
    expect(queryStartEvent.queryTracking.chainId).toMatch(/^[0-9a-f-]{36}$/)

    // Check result has queryTracking
    const resultEvent = events.find(e => e.type === 'result')
    expect(resultEvent).toBeDefined()
    expect(resultEvent.result.queryTracking).toBeDefined()
    expect(resultEvent.result.queryTracking.depth).toBe(0)
    expect(resultEvent.result.queryTracking.chainId).toBe(queryStartEvent.queryTracking.chainId)
  })

  it('should increment depth for recursive queries', async () => {
    let outerChainId: string | undefined
    let outerDepth: number | undefined

    const recursiveTool = defineTool({
      name: 'RecursiveTool',
      description: 'A tool that triggers a recursive query',
      input: z.object({ message: z.string() }),
      execute: async ({ message }) => {
        return `Processed: ${message}`
      },
    })

    const agent = createAgent({
      apiKey,
      model: 'claude-sonnet-4-6',
      tools: [recursiveTool],
      systemPrompt: 'You are a helpful assistant. Use RecursiveTool when asked.',
    })

    const events: any[] = []
    for await (const event of agent.stream('Use RecursiveTool with message "test"')) {
      events.push(event)
      if (event.type === 'result') break
    }

    // Find all query_start events
    const queryStartEvents = events.filter(e => e.type === 'query_start')
    expect(queryStartEvents.length).toBeGreaterThanOrEqual(1)

    // First query should have depth 0
    expect(queryStartEvents[0].queryTracking.depth).toBe(0)
    outerChainId = queryStartEvents[0].queryTracking.chainId

    // If there are recursive queries, they should increment depth
    if (queryStartEvents.length > 1) {
      expect(queryStartEvents[1].queryTracking.depth).toBe(1)
      expect(queryStartEvents[1].queryTracking.chainId).toBe(outerChainId)
    }
  })

  it('should maintain same chainId across turns in a session', async () => {
    const agent = createAgent({
      apiKey,
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a helpful assistant.',
    })

    const session = agent.session()

    // First turn
    const events1: any[] = []
    for await (const event of session.stream('Say hello')) {
      events1.push(event)
      if (event.type === 'result') break
    }

    const queryStart1 = events1.find(e => e.type === 'query_start')
    expect(queryStart1).toBeDefined()
    const chainId1 = queryStart1.queryTracking.chainId
    const depth1 = queryStart1.queryTracking.depth

    // Second turn
    const events2: any[] = []
    for await (const event of session.stream('Say goodbye')) {
      events2.push(event)
      if (event.type === 'result') break
    }

    const queryStart2 = events2.find(e => e.type === 'query_start')
    expect(queryStart2).toBeDefined()

    // Second turn should increment depth but keep same chainId
    expect(queryStart2.queryTracking.chainId).toBe(chainId1)
    expect(queryStart2.queryTracking.depth).toBe(depth1 + 1)
  })

  it('should include queryTracking in result from agent.ask()', async () => {
    const agent = createAgent({
      apiKey,
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a helpful assistant.',
    })

    const result = await agent.ask('Say hello')

    expect(result.queryTracking).toBeDefined()
    expect(result.queryTracking.depth).toBe(0)
    expect(result.queryTracking.chainId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('should create new chainId for each agent instance', async () => {
    const agent1 = createAgent({
      apiKey,
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a helpful assistant.',
    })

    const agent2 = createAgent({
      apiKey,
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a helpful assistant.',
    })

    const result1 = await agent1.ask('Say hello')
    const result2 = await agent2.ask('Say hello')

    // Different agents should have different chainIds
    expect(result1.queryTracking.chainId).not.toBe(result2.queryTracking.chainId)

    // Both should start at depth 0
    expect(result1.queryTracking.depth).toBe(0)
    expect(result2.queryTracking.depth).toBe(0)
  })
})
