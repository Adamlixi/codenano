/**
 * Tests for compact.ts — token estimation, auto-compact thresholds, and 413 detection.
 */

import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  shouldAutoCompact,
  isPromptTooLongError,
} from '../src/compact.js'
import type { AgentConfig, Usage } from '../src/types.js'

// ─── estimateTokens ────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates based on char length / 4 when no usage provided', () => {
    const messages = [
      { role: 'user', content: 'Hello world' }, // 11 chars -> ~3 tokens
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBe(Math.ceil(11 / 3.5)) // 4
  })

  it('handles array content with text blocks', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },        // 5 chars
          { type: 'text', text: ' world!' },       // 7 chars
        ],
      },
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBe(Math.ceil(12 / 3.5)) // 4
  })

  it('handles tool_result content', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x', content: 'file contents here' }, // 18 chars
        ],
      },
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBe(Math.ceil(18 / 3.5)) // 6
  })

  it('handles tool_use blocks with JSON input', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'x', name: 'Read', input: { path: '/tmp/foo' } },
        ],
      },
    ]
    const tokens = estimateTokens(messages)
    // JSON.stringify({ path: '/tmp/foo' }) = '{"path":"/tmp/foo"}' = 19 chars
    // Base: ceil(19/3.5) = 6, Tool overhead: 50, Total: 56
    expect(tokens).toBe(Math.ceil(19 / 3.5) + 50)
  })

  it('returns usage-based count when lastUsage provided', () => {
    const usage: Usage = {
      inputTokens: 5000,
      outputTokens: 1000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }
    const messages = [
      { role: 'user', content: 'x'.repeat(1000) },
    ]
    const tokens = estimateTokens(messages, usage)
    // Should use usage, not char estimation
    expect(tokens).toBe(6000) // inputTokens + outputTokens
  })

  it('handles empty messages', () => {
    expect(estimateTokens([])).toBe(0)
  })

  it('handles mixed message types', () => {
    const messages = [
      { role: 'user', content: 'Hello' },      // 5 chars
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hi there' },   // 8 chars
        ],
      },
      { role: 'user', content: 'Bye' },         // 3 chars
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBe(Math.ceil(16 / 3.5)) // 5 tokens with improved formula
  })
})

// ─── shouldAutoCompact ──────────────────────────────────────────────────────

describe('shouldAutoCompact', () => {
  const baseConfig: AgentConfig = {
    model: 'claude-sonnet-4-6',
  }

  it('returns false when autoCompact is disabled', () => {
    const config = { ...baseConfig, autoCompact: false }
    const usage: Usage = {
      inputTokens: 999_999,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }
    expect(shouldAutoCompact([], config, usage)).toBe(false)
  })

  it('returns false when no usage provided (first turn)', () => {
    // Without lastUsage, shouldAutoCompact relies on char estimation,
    // which for empty messages returns 0
    expect(shouldAutoCompact([], baseConfig)).toBe(false)
  })

  it('returns false when below threshold', () => {
    const usage: Usage = {
      inputTokens: 10_000,
      outputTokens: 1_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }
    expect(shouldAutoCompact([], baseConfig, usage)).toBe(false)
  })

  it('returns true when above threshold', () => {
    // maxOutputTokens defaults to 16384 (< 20k reserve), so reserve = 16384
    // Threshold: 200_000 - 16_384 - 13_000 = 170_616
    const usage: Usage = {
      inputTokens: 165_000,
      outputTokens: 10_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }
    // 175_000 > 170_616 → true
    expect(shouldAutoCompact([], baseConfig, usage)).toBe(true)
  })

  it('respects maxOutputTokens in threshold calculation', () => {
    // With maxOutputTokens = 8192 (< 20k reserve), effective reserve = 8192
    // Threshold: 200_000 - 8_192 - 13_000 = 178_808
    const config = { ...baseConfig, maxOutputTokens: 8192 }
    const usage: Usage = {
      inputTokens: 170_000,
      outputTokens: 5_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }
    // 175_000 < 178_808 → false
    expect(shouldAutoCompact([], config, usage)).toBe(false)
  })
})

// ─── isPromptTooLongError ───────────────────────────────────────────────────

describe('isPromptTooLongError', () => {
  it('detects "prompt is too long" message', () => {
    expect(isPromptTooLongError(new Error('prompt is too long'))).toBe(true)
  })

  it('detects "prompt too long" message', () => {
    expect(isPromptTooLongError(new Error('Prompt too long for model'))).toBe(true)
  })

  it('detects context window exceeded', () => {
    expect(isPromptTooLongError(new Error('context window exceeded'))).toBe(true)
  })

  it('detects 413 in error message', () => {
    expect(isPromptTooLongError(new Error('API returned 413'))).toBe(true)
  })

  it('detects 413 status code on error object', () => {
    const error = new Error('Request too large') as any
    error.status = 413
    expect(isPromptTooLongError(error)).toBe(true)
  })

  it('detects "request too large"', () => {
    expect(isPromptTooLongError(new Error('request too large'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isPromptTooLongError(new Error('network timeout'))).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isPromptTooLongError(null)).toBe(false)
    expect(isPromptTooLongError(undefined)).toBe(false)
  })

  it('returns false for non-Error objects', () => {
    expect(isPromptTooLongError({ message: 'prompt is too long' })).toBe(false)
    expect(isPromptTooLongError('prompt is too long')).toBe(false)
  })

  it('returns true for 413 status even with generic message', () => {
    const error = { status: 413, message: 'error' }
    expect(isPromptTooLongError(error)).toBe(true)
  })
})
