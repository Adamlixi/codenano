/**
 * Unit tests for memory prompt generation
 */

import { describe, it, expect } from 'vitest'
import { buildMemoryPrompt } from '../src/memory/prompt.js'
import type { Memory } from '../src/memory/types.js'

describe('buildMemoryPrompt', () => {
  it('returns empty string when no memories and no index', () => {
    expect(buildMemoryPrompt([])).toBe('')
    expect(buildMemoryPrompt([], null)).toBe('')
    expect(buildMemoryPrompt([], undefined)).toBe('')
  })

  it('includes index content when provided', () => {
    const result = buildMemoryPrompt([], '- [foo](foo.md) — a memory')
    expect(result).toContain('## Memory Index')
    expect(result).toContain('- [foo](foo.md) — a memory')
  })

  it('includes loaded memories', () => {
    const memories: Memory[] = [
      { name: 'user_role', description: 'User is a backend dev', type: 'user', content: 'Knows Go and Python' },
      { name: 'feedback_style', description: 'Prefers terse output', type: 'feedback', content: 'No summaries' },
    ]
    const result = buildMemoryPrompt(memories)
    expect(result).toContain('## Loaded Memories (2)')
    expect(result).toContain('### user_role (user)')
    expect(result).toContain('Knows Go and Python')
    expect(result).toContain('### feedback_style (feedback)')
    expect(result).toContain('No summaries')
  })

  it('includes both index and memories', () => {
    const memories: Memory[] = [
      { name: 'proj', description: 'Project info', type: 'project', content: 'Deadline is Friday' },
    ]
    const result = buildMemoryPrompt(memories, '- [proj](proj.md) — Project info')
    expect(result).toContain('## Memory Index')
    expect(result).toContain('## Loaded Memories (1)')
    expect(result).toContain('# auto memory')
  })

  it('includes memory type descriptions', () => {
    const result = buildMemoryPrompt([], '- index')
    expect(result).toContain('**user**')
    expect(result).toContain('**feedback**')
    expect(result).toContain('**project**')
    expect(result).toContain('**reference**')
  })
})
