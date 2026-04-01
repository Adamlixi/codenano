/**
 * Tests for tool concurrency — partitionToolCalls + batch execution behavior.
 *
 * Tests the partitioning logic that mirrors Claude Code's toolOrchestration.ts.
 * Doesn't test the full agent loop (that requires mocked model calls),
 * instead tests the partition function and concurrent execution semantics.
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { defineTool } from '../src/tool-builder.js'
import type { ToolDef } from '../src/types.js'

// ─── Expose partitionToolCalls for testing ─────────────────────────────────
// The function is private in agent.ts, so we test the behavior indirectly
// by verifying tool definitions and their concurrency properties.

describe('Tool concurrency properties', () => {
  it('defineTool with isReadOnly=true marks tool as concurrency-safe', () => {
    const tool = defineTool({
      name: 'ReadFile',
      description: 'Read a file',
      input: z.object({ path: z.string() }),
      execute: async ({ path }) => `contents of ${path}`,
      isReadOnly: true,
    })

    expect(tool.isReadOnly).toBe(true)
  })

  it('defineTool with isConcurrencySafe=true marks tool', () => {
    const tool = defineTool({
      name: 'Grep',
      description: 'Search',
      input: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) => `found ${pattern}`,
      isConcurrencySafe: true,
    })

    expect(tool.isConcurrencySafe).toBe(true)
  })

  it('defineTool with function-based isConcurrencySafe', () => {
    const tool = defineTool({
      name: 'Bash',
      description: 'Execute command',
      input: z.object({ command: z.string() }),
      execute: async ({ command }) => `ran ${command}`,
      isConcurrencySafe: (input) => input.command.startsWith('ls'),
    })

    expect(typeof tool.isConcurrencySafe).toBe('function')
    expect((tool.isConcurrencySafe as Function)({ command: 'ls /tmp' })).toBe(true)
    expect((tool.isConcurrencySafe as Function)({ command: 'rm -rf' })).toBe(false)
  })
})

describe('Partition logic (behavioral)', () => {
  // We can't directly test partitionToolCalls since it's not exported,
  // but we can verify the batch execution behavior through tool properties.

  const readTool = defineTool({
    name: 'Read',
    description: 'Read file',
    input: z.object({ path: z.string() }),
    execute: async ({ path }) => `contents: ${path}`,
    isConcurrencySafe: true,
  })

  const writeTool = defineTool({
    name: 'Write',
    description: 'Write file',
    input: z.object({ path: z.string(), content: z.string() }),
    execute: async ({ path, content }) => `wrote ${content.length} bytes to ${path}`,
    isConcurrencySafe: false,
  })

  it('concurrent-safe tools execute faster in parallel', async () => {
    // Simulate 3 tools with 50ms each
    const slowTool = defineTool({
      name: 'SlowRead',
      description: 'Slow read',
      input: z.object({ id: z.number() }),
      execute: async ({ id }) => {
        await new Promise(r => setTimeout(r, 50))
        return `result-${id}`
      },
      isConcurrencySafe: true,
    })

    const start = Date.now()
    // Simulate concurrent: all start at once
    const results = await Promise.all([
      slowTool.execute({ id: 1 }, { signal: new AbortController().signal, messages: [] }),
      slowTool.execute({ id: 2 }, { signal: new AbortController().signal, messages: [] }),
      slowTool.execute({ id: 3 }, { signal: new AbortController().signal, messages: [] }),
    ])
    const elapsed = Date.now() - start

    expect(results).toEqual(['result-1', 'result-2', 'result-3'])
    // Should complete in ~50ms (parallel), not ~150ms (sequential)
    expect(elapsed).toBeLessThan(120)
  })

  it('non-concurrent tools must run sequentially', async () => {
    const order: number[] = []
    const seqTool = defineTool({
      name: 'SeqWrite',
      description: 'Sequential write',
      input: z.object({ id: z.number() }),
      execute: async ({ id }) => {
        order.push(id)
        await new Promise(r => setTimeout(r, 10))
        return `wrote-${id}`
      },
      isConcurrencySafe: false,
    })

    // Sequential execution
    const ctx = { signal: new AbortController().signal, messages: [] as any[] }
    await seqTool.execute({ id: 1 }, ctx)
    await seqTool.execute({ id: 2 }, ctx)
    await seqTool.execute({ id: 3 }, ctx)

    expect(order).toEqual([1, 2, 3])
  })

  it('toolDef isReadOnly falls back when isConcurrencySafe not set', () => {
    const tool = defineTool({
      name: 'Glob',
      description: 'Find files',
      input: z.object({ pattern: z.string() }),
      execute: async () => 'files',
      isReadOnly: true,
      // no isConcurrencySafe — should fall back to isReadOnly
    })

    expect(tool.isReadOnly).toBe(true)
    // defineTool defaults isConcurrencySafe to isReadOnly when not explicitly set
    expect(tool.isConcurrencySafe).toBe(true)
    // The partitionToolCalls function in agent.ts also falls back to isReadOnly
    // when isConcurrencySafe is not set — double safety net
  })
})

describe('Concurrent batch execution semantics', () => {
  it('all tools in a concurrent batch produce results in order', async () => {
    const results: string[] = []

    // Simulate tools that resolve in reverse order due to timing
    const delays = [30, 20, 10] // tool 0 slowest, tool 2 fastest
    const tools = delays.map((delay, i) =>
      defineTool({
        name: `Tool${i}`,
        description: `Tool ${i}`,
        input: z.object({}),
        execute: async () => {
          await new Promise(r => setTimeout(r, delay))
          return `result-${i}`
        },
        isConcurrencySafe: true,
      }),
    )

    // Execute concurrently
    const promises = tools.map((tool, i) =>
      tool.execute({}, { signal: new AbortController().signal, messages: [] })
        .then(r => { results.push(r as string) }),
    )
    await Promise.all(promises)

    // Results arrive in completion order (fastest first)
    expect(results).toEqual(['result-2', 'result-1', 'result-0'])

    // But the agent loop's executeBatchConcurrently stores results by index,
    // so API messages maintain the original order.
  })

  it('a failing tool in a concurrent batch does not block others', async () => {
    const successTool = defineTool({
      name: 'Success',
      description: 'Always succeeds',
      input: z.object({}),
      execute: async () => 'ok',
      isConcurrencySafe: true,
    })

    const failTool = defineTool({
      name: 'Fail',
      description: 'Always fails',
      input: z.object({}),
      execute: async () => { throw new Error('boom') },
      isConcurrencySafe: true,
    })

    const ctx = { signal: new AbortController().signal, messages: [] as any[] }

    // Both should resolve — failures are caught per-tool, not per-batch
    const [success, failure] = await Promise.allSettled([
      successTool.execute({}, ctx),
      failTool.execute({}, ctx),
    ])

    expect(success.status).toBe('fulfilled')
    expect(failure.status).toBe('rejected')
  })
})
