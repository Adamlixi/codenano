/**
 * Unit tests for BashTool, GlobTool, GrepTool, BriefTool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { BashTool } from '../src/tools/BashTool.js'
import { GlobTool } from '../src/tools/GlobTool.js'
import { GrepTool } from '../src/tools/GrepTool.js'
import { BriefTool } from '../src/tools/BriefTool.js'

const signal = new AbortController().signal
const ctx = { signal, messages: [] }

describe('BashTool', () => {
  it('executes a simple command', async () => {
    const result = await BashTool.execute({ command: 'echo hello' }, ctx)
    expect(result).toContain('hello')
  })

  it('returns error output for failing command', async () => {
    const result = await BashTool.execute({ command: 'false' }, ctx) as any
    expect(result.isError).toBe(true)
  })

  it('respects timeout', async () => {
    const result = await BashTool.execute({ command: 'sleep 10', timeout: 500 }, ctx) as any
    expect(result.isError).toBe(true)
  })

  it('runs background command', async () => {
    const result = await BashTool.execute({ command: 'echo bg', run_in_background: true }, ctx)
    expect(result).toContain('Background process started')
  })

  it('isReadOnly detects read commands', () => {
    const fn = BashTool.isReadOnly as (input: any) => boolean
    expect(fn({ command: 'ls -la' })).toBe(true)
    expect(fn({ command: 'git status' })).toBe(true)
    expect(fn({ command: 'rm -rf /' })).toBe(false)
    expect(fn({ command: 'npm install' })).toBe(false)
  })

  it('isConcurrencySafe detects safe commands', () => {
    const fn = BashTool.isConcurrencySafe as (input: any) => boolean
    expect(fn({ command: 'cat file.txt' })).toBe(true)
    expect(fn({ command: 'echo hello' })).toBe(true)
    expect(fn({ command: 'mkdir foo' })).toBe(false)
  })
})

describe('GlobTool', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'glob-test-'))
    writeFileSync(join(dir, 'a.ts'), '')
    writeFileSync(join(dir, 'b.ts'), '')
    writeFileSync(join(dir, 'c.js'), '')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('finds files matching pattern', async () => {
    const result = await GlobTool.execute({ pattern: '*.ts', path: dir }, ctx)
    expect(result).toContain('a.ts')
    expect(result).toContain('b.ts')
    expect(result).not.toContain('c.js')
  })

  it('returns message when no matches', async () => {
    const result = await GlobTool.execute({ pattern: '*.py', path: dir }, ctx)
    expect(result).toContain('No files matched')
  })
})

describe('GrepTool', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grep-test-'))
    writeFileSync(join(dir, 'hello.txt'), 'hello world\nfoo bar\nhello again')
    writeFileSync(join(dir, 'other.txt'), 'nothing here')
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('finds files with matches (default mode)', async () => {
    const result = await GrepTool.execute({ pattern: 'hello', path: dir }, ctx)
    expect(result).toContain('hello.txt')
    expect(result).not.toContain('other.txt')
  })

  it('shows content with line numbers', async () => {
    const result = await GrepTool.execute(
      { pattern: 'hello', path: dir, output_mode: 'content' },
      ctx,
    )
    expect(result).toContain('hello world')
    expect(result).toContain('hello again')
  })

  it('returns no matches message', async () => {
    const result = await GrepTool.execute({ pattern: 'zzzzz', path: dir }, ctx)
    expect(result).toContain('No matches found')
  })

  it('supports case insensitive search', async () => {
    const result = await GrepTool.execute(
      { pattern: 'HELLO', path: dir, '-i': true },
      ctx,
    )
    expect(result).toContain('hello.txt')
  })
})

describe('BriefTool', () => {
  it('returns the message as-is', async () => {
    const result = await BriefTool.execute({ message: 'Hello user!' }, ctx)
    expect(result).toBe('Hello user!')
  })
})
