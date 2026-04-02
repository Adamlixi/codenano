/**
 * query-tracking-unit.test.ts — Unit tests for Query Tracking
 */

import { describe, it, expect } from 'vitest'
import type { QueryTracking } from '../src/types.js'

describe('Query Tracking Types', () => {
  it('should have correct QueryTracking structure', () => {
    const tracking: QueryTracking = {
      chainId: '123e4567-e89b-12d3-a456-426614174000',
      depth: 0,
    }

    expect(tracking.chainId).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(tracking.depth).toBe(0)
  })

  it('should allow depth increment', () => {
    const tracking1: QueryTracking = {
      chainId: 'test-chain-id',
      depth: 0,
    }

    const tracking2: QueryTracking = {
      chainId: tracking1.chainId,
      depth: tracking1.depth + 1,
    }

    expect(tracking2.chainId).toBe(tracking1.chainId)
    expect(tracking2.depth).toBe(1)
  })
})
