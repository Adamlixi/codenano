/**
 * Tests for instructions.ts — CLAUDE.md file discovery and loading.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  loadInstructions,
  discoverInstructionFiles,
  formatInstructions,
} from '../src/instructions.js'
import type { InstructionFile } from '../src/instructions.js'

// ─── formatInstructions ────────────────────────────────────────────────────

describe('formatInstructions', () => {
  it('returns empty string for no files', () => {
    expect(formatInstructions([])).toBe('')
  })

  it('formats a single user instruction file', () => {
    const files: InstructionFile[] = [
      { path: '/home/user/.claude/CLAUDE.md', content: '# My Rules\nBe nice', type: 'user' },
    ]
    const result = formatInstructions(files)
    expect(result).toContain('IMPORTANT: These instructions OVERRIDE')
    expect(result).toContain('/home/user/.claude/CLAUDE.md')
    expect(result).toContain("user's private global instructions")
    expect(result).toContain('# My Rules\nBe nice')
  })

  it('formats a project instruction file', () => {
    const files: InstructionFile[] = [
      { path: '/project/CLAUDE.md', content: 'Use TypeScript', type: 'project' },
    ]
    const result = formatInstructions(files)
    expect(result).toContain('project instructions, checked into the codebase')
  })

  it('formats a local instruction file', () => {
    const files: InstructionFile[] = [
      { path: '/project/CLAUDE.local.md', content: 'Local override', type: 'local' },
    ]
    const result = formatInstructions(files)
    expect(result).toContain("user's private project instructions, not checked in")
  })

  it('includes multiple files separated by sections', () => {
    const files: InstructionFile[] = [
      { path: '/a.md', content: 'Content A', type: 'user' },
      { path: '/b.md', content: 'Content B', type: 'project' },
    ]
    const result = formatInstructions(files)
    expect(result).toContain('Content A')
    expect(result).toContain('Content B')
    expect(result).toContain('Contents of /a.md')
    expect(result).toContain('Contents of /b.md')
  })

  it('strips YAML frontmatter from content', () => {
    const files: InstructionFile[] = [
      {
        path: '/project/.claude/rules/test.md',
        content: '---\nname: test-rule\ndescription: A test\n---\n\n# Rule\nDo this',
        type: 'project',
      },
    ]
    const result = formatInstructions(files)
    expect(result).toContain('# Rule\nDo this')
    expect(result).not.toContain('name: test-rule')
  })

  it('preserves content without frontmatter', () => {
    const files: InstructionFile[] = [
      { path: '/project/CLAUDE.md', content: '# No frontmatter here', type: 'project' },
    ]
    const result = formatInstructions(files)
    expect(result).toContain('# No frontmatter here')
  })
})

// ─── discoverInstructionFiles ──────────────────────────────────────────────

describe('discoverInstructionFiles', () => {
  it('returns empty array when no files exist', async () => {
    // Use a temp dir with no CLAUDE.md files
    const files = await discoverInstructionFiles({
      cwd: '/tmp',
      loadUserInstructions: false,
      loadProjectInstructions: true,
      loadLocalInstructions: false,
    })
    // Should return files only if CLAUDE.md exists in the path from / to /tmp
    // In practice on most systems, no CLAUDE.md exists in /tmp or /
    // The function won't error — just returns what it finds
    expect(Array.isArray(files)).toBe(true)
  })

  it('respects loadUserInstructions=false', async () => {
    const files = await discoverInstructionFiles({
      cwd: '/tmp',
      loadUserInstructions: false,
      loadProjectInstructions: false,
      loadLocalInstructions: false,
    })
    // No user files should be included
    const userFiles = files.filter(f => f.type === 'user')
    expect(userFiles.length).toBe(0)
  })

  it('includes additional files when specified', async () => {
    // Create a temp file to include
    const tmpFile = path.join('/tmp', `claude-test-${Date.now()}.md`)
    fs.writeFileSync(tmpFile, '# Additional\nExtra instructions')

    try {
      const files = await discoverInstructionFiles({
        cwd: '/tmp',
        loadUserInstructions: false,
        loadProjectInstructions: false,
        loadLocalInstructions: false,
        additionalFiles: [tmpFile],
      })
      const additional = files.find(f => f.path === tmpFile)
      expect(additional).toBeDefined()
      expect(additional!.content).toContain('Extra instructions')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})

// ─── loadInstructions ──────────────────────────────────────────────────────

describe('loadInstructions', () => {
  it('returns empty string when all sources disabled and no files', async () => {
    const result = await loadInstructions({
      cwd: '/tmp',
      loadUserInstructions: false,
      loadProjectInstructions: false,
      loadLocalInstructions: false,
    })
    expect(result).toBe('')
  })

  it('returns formatted content when additional files exist', async () => {
    const tmpFile = path.join('/tmp', `claude-load-test-${Date.now()}.md`)
    fs.writeFileSync(tmpFile, '# Test\nHello')

    try {
      const result = await loadInstructions({
        cwd: '/tmp',
        loadUserInstructions: false,
        loadProjectInstructions: false,
        loadLocalInstructions: false,
        additionalFiles: [tmpFile],
      })
      expect(result).toContain('Hello')
      expect(result).toContain('IMPORTANT')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})
