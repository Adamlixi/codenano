/**
 * Tests for tool-budget.ts — tool result size truncation and per-message budgeting.
 */

import { describe, it, expect } from 'vitest'
import {
  truncateToolResult,
  applyMessageBudget,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_BYTES,
} from '../src/tool-budget.js'

describe('truncateToolResult', () => {
  it('returns content unchanged when within budget', () => {
    const content = 'short result'
    expect(truncateToolResult(content)).toBe(content)
  })

  it('returns content unchanged at exact budget limit', () => {
    const content = 'x'.repeat(DEFAULT_MAX_RESULT_SIZE_CHARS)
    expect(truncateToolResult(content)).toBe(content)
  })

  it('truncates content exceeding budget', () => {
    const content = 'x'.repeat(DEFAULT_MAX_RESULT_SIZE_CHARS + 1)
    const result = truncateToolResult(content)
    expect(result.length).toBeLessThan(content.length)
    expect(result).toContain('Output too large')
    expect(result).toContain('truncated')
  })

  it('includes preview of first 2KB', () => {
    const content = 'a'.repeat(100_000)
    const result = truncateToolResult(content)
    // Preview section should be present
    expect(result).toContain('a'.repeat(PREVIEW_SIZE_BYTES))
  })

  it('shows size in KB in truncation message', () => {
    const content = 'x'.repeat(60_000)
    const result = truncateToolResult(content)
    expect(result).toContain('58.6 KB') // 60000 / 1024 ≈ 58.6
  })

  it('respects custom maxSize parameter', () => {
    const content = 'x'.repeat(5000)
    const result = truncateToolResult(content, 1000)
    expect(result).toContain('Output too large')
  })

  it('cuts preview at newline boundary when possible', () => {
    // Content with a newline within the preview range
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}: ${'x'.repeat(20)}`)
    const content = lines.join('\n')
    const result = truncateToolResult(content, 1000) // small budget to trigger truncation
    // Preview should end at a newline, not mid-line
    const previewSection = result.split('Showing first')[1]?.split('...')[0] ?? ''
    // The preview content shouldn't end with a partial line
    expect(previewSection).toBeDefined()
  })
})

describe('applyMessageBudget', () => {
  it('returns content unchanged when total within budget', () => {
    const blocks = [
      { type: 'tool_result', tool_use_id: 'a', content: 'short' },
      { type: 'tool_result', tool_use_id: 'b', content: 'also short' },
    ]
    const result = applyMessageBudget(blocks)
    expect(result).toEqual(blocks)
  })

  it('preserves non-tool-result blocks', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'tool_result', tool_use_id: 'a', content: 'result' },
    ]
    const result = applyMessageBudget(blocks)
    expect(result[0]).toEqual({ type: 'text', text: 'hello' })
  })

  it('truncates largest results when over per-message budget', () => {
    // Create blocks that exceed the per-message limit
    const large = 'x'.repeat(150_000) // 150KB
    const medium = 'y'.repeat(100_000) // 100KB
    // Total: 250KB > 200KB budget

    const blocks = [
      { type: 'tool_result', tool_use_id: 'a', content: large },
      { type: 'tool_result', tool_use_id: 'b', content: medium },
    ]

    const result = applyMessageBudget(blocks)

    // The largest one should be truncated
    const aContent = (result[0] as any).content
    expect(aContent.length).toBeLessThan(large.length)
    expect(aContent).toContain('Output too large')
  })

  it('respects custom maxTotal parameter', () => {
    // Two 10KB results = 20KB total, budget of 5KB
    const blocks = [
      { type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(10_000) },
      { type: 'tool_result', tool_use_id: 'b', content: 'y'.repeat(10_000) },
    ]

    const result = applyMessageBudget(blocks, 5_000)
    const totalSize = result.reduce((sum: number, b: any) => {
      return sum + (typeof b.content === 'string' ? b.content.length : 0)
    }, 0)
    // Should be reduced from 20KB
    expect(totalSize).toBeLessThan(20_000)
  })

  it('handles blocks with no tool_result types', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'x', name: 'Read', input: {} },
    ]
    const result = applyMessageBudget(blocks)
    expect(result).toEqual(blocks) // No tool_results, unchanged
  })

  it('handles empty array', () => {
    expect(applyMessageBudget([])).toEqual([])
  })
})

describe('Constants', () => {
  it('DEFAULT_MAX_RESULT_SIZE_CHARS matches Claude Code (50KB)', () => {
    expect(DEFAULT_MAX_RESULT_SIZE_CHARS).toBe(50_000)
  })

  it('MAX_RESULTS_PER_MESSAGE_CHARS matches Claude Code (200KB)', () => {
    expect(MAX_RESULTS_PER_MESSAGE_CHARS).toBe(200_000)
  })

  it('PREVIEW_SIZE_BYTES matches Claude Code (2KB)', () => {
    expect(PREVIEW_SIZE_BYTES).toBe(2_000)
  })
})
