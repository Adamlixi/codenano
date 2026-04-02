/**
 * Unit tests for memory section in system prompt
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { getMemorySection } from '../src/prompt/sections/memory.js'
import { saveMemory } from '../src/memory/storage.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('getMemorySection', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memory-section-test-'))
  })

  it('returns null when no memories exist', () => {
    const result = getMemorySection(tempDir)
    expect(result).toBeNull()
  })

  it('returns prompt with loaded memories', () => {
    saveMemory(
      { name: 'user_pref', description: 'User prefers Go', type: 'user', content: 'Expert in Go' },
      tempDir,
    )

    const result = getMemorySection(tempDir)
    expect(result).not.toBeNull()
    expect(result).toContain('user_pref')
    expect(result).toContain('Expert in Go')
    expect(result).toContain('# auto memory')
  })

  it('returns null for non-existent directory', () => {
    const result = getMemorySection(join(tempDir, 'does-not-exist'))
    expect(result).toBeNull()
  })
})
