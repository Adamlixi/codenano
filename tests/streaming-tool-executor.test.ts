/**
 * Tests for StreamingToolExecutor — tool execution during model streaming.
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { StreamingToolExecutor } from '../src/streaming-tool-executor.js'
import type { ToolDef, AgentConfig } from '../src/types.js'
import type Anthropic from '@anthropic-ai/sdk'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTool(overrides: Partial<ToolDef> = {}): ToolDef {
  return {
    name: 'TestTool',
    description: 'A test tool',
    input: z.object({ value: z.string() }),
    execute: async ({ value }) => `result: ${value}`,
    isConcurrencySafe: true,
    ...overrides,
  }
}

function makeBlock(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input } as Anthropic.ToolUseBlock
}

function makeExecutor(
  tools: ToolDef[],
  config: Partial<AgentConfig> = {},
): StreamingToolExecutor {
  const toolMap = new Map(tools.map(t => [t.name, t]))
  return new StreamingToolExecutor(
    toolMap,
    { model: 'test', tools, ...config } as AgentConfig,
    new AbortController().signal,
    [],
    true,
  )
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('StreamingToolExecutor', () => {
  describe('addTool + getCompletedResults', () => {
    it('executes a single tool and yields result', async () => {
      const tool = makeTool()
      const executor = makeExecutor([tool])

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'hello' }))

      // Wait for execution
      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(1)
      expect(results[0].event.type).toBe('tool_result')
      expect(results[0].event.output).toBe('result: hello')
      expect(results[0].event.isError).toBe(false)
    })

    it('executes multiple concurrent-safe tools in parallel', async () => {
      const executionOrder: string[] = []
      const tool = makeTool({
        execute: async ({ value }: { value: string }) => {
          executionOrder.push(`start:${value}`)
          await new Promise(r => setTimeout(r, 10))
          executionOrder.push(`end:${value}`)
          return `done:${value}`
        },
      })
      const executor = makeExecutor([tool])

      // Add two tools rapidly
      executor.addTool(makeBlock('t1', 'TestTool', { value: 'a' }))
      executor.addTool(makeBlock('t2', 'TestTool', { value: 'b' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(2)
      // Both should have started before either ended (parallel)
      expect(executionOrder[0]).toBe('start:a')
      expect(executionOrder[1]).toBe('start:b')
    })

    it('executes non-safe tools sequentially', async () => {
      const executionOrder: string[] = []
      const tool = makeTool({
        isConcurrencySafe: false,
        execute: async ({ value }: { value: string }) => {
          executionOrder.push(`start:${value}`)
          await new Promise(r => setTimeout(r, 10))
          executionOrder.push(`end:${value}`)
          return `done:${value}`
        },
      })
      const executor = makeExecutor([tool])

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'a' }))
      executor.addTool(makeBlock('t2', 'TestTool', { value: 'b' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(2)
      // First must finish before second starts (sequential)
      expect(executionOrder).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    })

    it('blocks non-safe tool behind safe tools', async () => {
      const executionOrder: string[] = []
      const safeTool = makeTool({
        name: 'Safe',
        isConcurrencySafe: true,
        execute: async ({ value }: { value: string }) => {
          executionOrder.push(`safe:start:${value}`)
          await new Promise(r => setTimeout(r, 20))
          executionOrder.push(`safe:end:${value}`)
          return 'ok'
        },
      })
      const unsafeTool = makeTool({
        name: 'Unsafe',
        isConcurrencySafe: false,
        execute: async ({ value }: { value: string }) => {
          executionOrder.push(`unsafe:start:${value}`)
          await new Promise(r => setTimeout(r, 10))
          executionOrder.push(`unsafe:end:${value}`)
          return 'ok'
        },
      })
      const executor = makeExecutor([safeTool, unsafeTool])

      executor.addTool(makeBlock('t1', 'Safe', { value: 'a' }))
      executor.addTool(makeBlock('t2', 'Unsafe', { value: 'b' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(2)
      // Unsafe should start after safe ends
      const unsafeStartIdx = executionOrder.indexOf('unsafe:start:b')
      const safeEndIdx = executionOrder.indexOf('safe:end:a')
      expect(unsafeStartIdx).toBeGreaterThan(safeEndIdx)
    })
  })

  describe('error handling', () => {
    it('returns error for unknown tool', async () => {
      const executor = makeExecutor([])

      executor.addTool(makeBlock('t1', 'NonExistent', { value: 'x' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(1)
      expect(results[0].event.isError).toBe(true)
      expect(results[0].event.output).toContain('Unknown tool')
    })

    it('returns error for invalid input', async () => {
      const tool = makeTool()
      const executor = makeExecutor([tool])

      executor.addTool(makeBlock('t1', 'TestTool', { wrong: 'field' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(1)
      expect(results[0].event.isError).toBe(true)
      expect(results[0].event.output).toContain('Input validation error')
    })

    it('returns error when tool throws', async () => {
      const tool = makeTool({
        execute: async () => { throw new Error('boom') },
      })
      const executor = makeExecutor([tool])

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'x' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(1)
      expect(results[0].event.isError).toBe(true)
      expect(results[0].event.output).toContain('boom')
    })
  })

  describe('permission check', () => {
    it('denies tool when canUseTool returns deny', async () => {
      const tool = makeTool()
      const executor = makeExecutor([tool], {
        canUseTool: () => ({ behavior: 'deny', message: 'Not allowed' }),
      })

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'x' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(1)
      expect(results[0].event.isError).toBe(true)
      expect(results[0].event.output).toContain('Permission denied')
    })
  })

  describe('discard', () => {
    it('yields synthetic errors for non-yielded tools', () => {
      const tool = makeTool({
        execute: async () => {
          await new Promise(r => setTimeout(r, 1000)) // Long-running
          return 'never'
        },
      })
      const executor = makeExecutor([tool])

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'x' }))

      const discarded: any[] = []
      for (const r of executor.discard()) {
        discarded.push(r)
      }

      expect(discarded).toHaveLength(1)
      expect(discarded[0].event.isError).toBe(true)
      expect(discarded[0].event.output).toContain('cancelled')
    })
  })

  describe('getCompletedResults (synchronous)', () => {
    it('returns empty when no tools added', () => {
      const executor = makeExecutor([makeTool()])
      const results = [...executor.getCompletedResults()]
      expect(results).toHaveLength(0)
    })

    it('returns empty when tools still executing', () => {
      const tool = makeTool({
        execute: async () => {
          await new Promise(r => setTimeout(r, 100))
          return 'slow'
        },
      })
      const executor = makeExecutor([tool])

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'x' }))

      // Synchronous check — tool still executing
      const results = [...executor.getCompletedResults()]
      expect(results).toHaveLength(0)
    })
  })

  describe('tool result budget', () => {
    it('truncates large tool output when budget enabled', async () => {
      const tool = makeTool({
        execute: async () => 'x'.repeat(60_000), // 60KB > 50KB limit
      })
      const executor = makeExecutor([tool])

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'big' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results).toHaveLength(1)
      expect(results[0].event.output.length).toBeLessThan(60_000)
      expect(results[0].event.output).toContain('Output too large')
    })

    it('does not truncate when budget disabled', async () => {
      const tool = makeTool({
        execute: async () => 'x'.repeat(60_000),
      })
      const toolMap = new Map([[tool.name, tool]])
      const executor = new StreamingToolExecutor(
        toolMap,
        { model: 'test', tools: [tool] } as AgentConfig,
        new AbortController().signal,
        [],
        false, // budget disabled
      )

      executor.addTool(makeBlock('t1', 'TestTool', { value: 'big' }))

      const results: any[] = []
      for await (const r of executor.getRemainingResults()) {
        results.push(r)
      }

      expect(results[0].event.output.length).toBe(60_000)
    })
  })
})
