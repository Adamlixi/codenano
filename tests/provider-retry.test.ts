/**
 * Tests for provider retry/backoff logic and FallbackTriggeredError.
 */

import { describe, it, expect } from 'vitest'
import {
  FallbackTriggeredError,
  getRetryDelay,
  CAPPED_DEFAULT_MAX_TOKENS,
  ESCALATED_MAX_TOKENS,
} from '../src/provider.js'

describe('FallbackTriggeredError', () => {
  it('creates error with original and fallback model', () => {
    const error = new FallbackTriggeredError('claude-opus-4-6', 'claude-sonnet-4-6')
    expect(error.name).toBe('FallbackTriggeredError')
    expect(error.originalModel).toBe('claude-opus-4-6')
    expect(error.fallbackModel).toBe('claude-sonnet-4-6')
    expect(error.message).toContain('claude-opus-4-6')
    expect(error.message).toContain('claude-sonnet-4-6')
  })

  it('is instanceof Error', () => {
    const error = new FallbackTriggeredError('a', 'b')
    expect(error instanceof Error).toBe(true)
    expect(error instanceof FallbackTriggeredError).toBe(true)
  })
})

describe('getRetryDelay', () => {
  it('returns delay in range [base, base*1.25] for attempt 0', () => {
    // attempt 0: base = 500 * 2^0 = 500, jitter up to 125
    const delay = getRetryDelay(0)
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(625)
  })

  it('increases exponentially with attempts', () => {
    // attempt 0: 500ms base
    // attempt 1: 1000ms base
    // attempt 2: 2000ms base
    const d0 = getRetryDelay(0)
    const d1 = getRetryDelay(1)
    const d2 = getRetryDelay(2)

    // Each should be roughly 2x the previous (within jitter)
    expect(d1).toBeGreaterThan(d0 * 1.3) // Allow for jitter variance
    expect(d2).toBeGreaterThan(d1 * 1.3)
  })

  it('caps at maxDelay', () => {
    // High attempt number should be capped
    const delay = getRetryDelay(100) // Would be astronomical without cap
    expect(delay).toBeLessThanOrEqual(32_000 * 1.25) // 32s max + 25% jitter
  })

  it('respects custom maxDelay', () => {
    const delay = getRetryDelay(10, 1000)
    expect(delay).toBeLessThanOrEqual(1250) // 1000 + 25% jitter
  })

  it('adds jitter (non-deterministic)', () => {
    // Run multiple times to verify jitter varies
    const delays = Array.from({ length: 20 }, () => getRetryDelay(2))
    const unique = new Set(delays)
    // With 20 samples, jitter should produce at least 2 different values
    expect(unique.size).toBeGreaterThan(1)
  })
})

describe('Max Output Token Constants', () => {
  it('CAPPED_DEFAULT_MAX_TOKENS matches Claude Code (8K)', () => {
    expect(CAPPED_DEFAULT_MAX_TOKENS).toBe(8_000)
  })

  it('ESCALATED_MAX_TOKENS matches Claude Code (64K)', () => {
    expect(ESCALATED_MAX_TOKENS).toBe(64_000)
  })
})
