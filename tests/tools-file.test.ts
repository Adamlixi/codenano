/**
 * Unit tests for file tools: FileReadTool, FileWriteTool, FileEditTool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileReadTool } from '../src/tools/FileReadTool.js'
import { FileWriteTool } from '../src/tools/FileWriteTool.js'
import { FileEditTool } from '../src/tools/FileEditTool.js'

const signal = new AbortController().signal
const ctx = { signal, messages: [] }

describe('FileReadTool', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'read-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('reads a file with line numbers', async () => {
    writeFileSync(join(dir, 'hello.txt'), 'line1\nline2\nline3')
    const result = await FileReadTool.execute({ file_path: join(dir, 'hello.txt') }, ctx)
    expect(result).toContain('1\tline1')
    expect(result).toContain('2\tline2')
    expect(result).toContain('3\tline3')
  })

  it('supports offset and limit', async () => {
    writeFileSync(join(dir, 'big.txt'), 'a\nb\nc\nd\ne')
    const result = await FileReadTool.execute({ file_path: join(dir, 'big.txt'), offset: 1, limit: 2 }, ctx)
    expect(result).toContain('2\tb')
    expect(result).toContain('3\tc')
    expect(result).not.toContain('1\ta')
    expect(result).not.toContain('4\td')
  })

  it('returns error for missing file', async () => {
    const result = await FileReadTool.execute({ file_path: join(dir, 'nope.txt') }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })

  it('returns error for directory', async () => {
    const result = await FileReadTool.execute({ file_path: dir }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('is a directory'), isError: true })
  })
})

describe('FileWriteTool', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'write-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates a new file', async () => {
    const fp = join(dir, 'new.txt')
    const result = await FileWriteTool.execute({ file_path: fp, content: 'hello\nworld' }, ctx)
    expect(result).toContain('created')
    expect(result).toContain('2 lines')
    expect(readFileSync(fp, 'utf-8')).toBe('hello\nworld')
  })

  it('overwrites an existing file', async () => {
    const fp = join(dir, 'exist.txt')
    writeFileSync(fp, 'old')
    const result = await FileWriteTool.execute({ file_path: fp, content: 'new' }, ctx)
    expect(result).toContain('overwrote')
    expect(readFileSync(fp, 'utf-8')).toBe('new')
  })

  it('creates parent directories', async () => {
    const fp = join(dir, 'a', 'b', 'c.txt')
    const result = await FileWriteTool.execute({ file_path: fp, content: 'deep' }, ctx)
    expect(result).toContain('created')
    expect(readFileSync(fp, 'utf-8')).toBe('deep')
  })
})

describe('FileEditTool', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'edit-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('replaces a unique string', async () => {
    const fp = join(dir, 'file.txt')
    writeFileSync(fp, 'hello world')
    const result = await FileEditTool.execute(
      { file_path: fp, old_string: 'hello', new_string: 'goodbye', replace_all: false },
      ctx,
    )
    expect(result).toContain('1 replacement')
    expect(readFileSync(fp, 'utf-8')).toBe('goodbye world')
  })

  it('replace_all replaces all occurrences', async () => {
    const fp = join(dir, 'file.txt')
    writeFileSync(fp, 'aaa bbb aaa')
    const result = await FileEditTool.execute(
      { file_path: fp, old_string: 'aaa', new_string: 'xxx', replace_all: true },
      ctx,
    )
    expect(result).toContain('2 replacements')
    expect(readFileSync(fp, 'utf-8')).toBe('xxx bbb xxx')
  })

  it('errors when old_string not found', async () => {
    const fp = join(dir, 'file.txt')
    writeFileSync(fp, 'hello')
    const result = await FileEditTool.execute(
      { file_path: fp, old_string: 'nope', new_string: 'x', replace_all: false },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })

  it('errors when old_string is not unique (without replace_all)', async () => {
    const fp = join(dir, 'file.txt')
    writeFileSync(fp, 'aaa bbb aaa')
    const result = await FileEditTool.execute(
      { file_path: fp, old_string: 'aaa', new_string: 'xxx', replace_all: false },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('multiple times'), isError: true })
  })

  it('errors when old_string equals new_string', async () => {
    const fp = join(dir, 'file.txt')
    writeFileSync(fp, 'hello')
    const result = await FileEditTool.execute(
      { file_path: fp, old_string: 'hello', new_string: 'hello', replace_all: false },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('identical'), isError: true })
  })

  it('errors for missing file', async () => {
    const result = await FileEditTool.execute(
      { file_path: join(dir, 'nope.txt'), old_string: 'a', new_string: 'b', replace_all: false },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })
})
