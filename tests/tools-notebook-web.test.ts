/**
 * Unit tests for NotebookEditTool and WebFetchTool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NotebookEditTool } from '../src/tools/NotebookEditTool.js'
import { WebFetchTool } from '../src/tools/WebFetchTool.js'

const signal = new AbortController().signal
const ctx = { signal, messages: [] }

// ─── NotebookEditTool ──────────────────────────────────────────────────────

describe('NotebookEditTool', () => {
  let dir: string
  const makeNotebook = (cells: any[]) => ({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells,
  })

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'notebook-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('replaces a cell by id', async () => {
    const nb = makeNotebook([
      { id: 'cell-1', cell_type: 'code', source: ['old code'], metadata: {} },
    ])
    const fp = join(dir, 'test.ipynb')
    writeFileSync(fp, JSON.stringify(nb))

    const result = await NotebookEditTool.execute(
      { notebook_path: fp, cell_id: 'cell-1', new_source: 'new code' },
      ctx,
    )
    expect(result).toContain('Replaced')

    const updated = JSON.parse(readFileSync(fp, 'utf-8'))
    expect(updated.cells[0].source).toEqual(['new code'])
  })

  it('inserts a cell at the end', async () => {
    const nb = makeNotebook([
      { id: 'cell-1', cell_type: 'code', source: ['x'], metadata: {} },
    ])
    const fp = join(dir, 'test.ipynb')
    writeFileSync(fp, JSON.stringify(nb))

    const result = await NotebookEditTool.execute(
      { notebook_path: fp, new_source: 'inserted', edit_mode: 'insert', cell_type: 'markdown' },
      ctx,
    )
    expect(result).toContain('Inserted')

    const updated = JSON.parse(readFileSync(fp, 'utf-8'))
    expect(updated.cells).toHaveLength(2)
    expect(updated.cells[1].cell_type).toBe('markdown')
  })

  it('inserts after a specific cell', async () => {
    const nb = makeNotebook([
      { id: 'c1', cell_type: 'code', source: ['a'], metadata: {} },
      { id: 'c2', cell_type: 'code', source: ['b'], metadata: {} },
    ])
    const fp = join(dir, 'test.ipynb')
    writeFileSync(fp, JSON.stringify(nb))

    await NotebookEditTool.execute(
      { notebook_path: fp, cell_id: 'c1', new_source: 'mid', edit_mode: 'insert' },
      ctx,
    )

    const updated = JSON.parse(readFileSync(fp, 'utf-8'))
    expect(updated.cells).toHaveLength(3)
    expect(updated.cells[1].source).toEqual(['mid'])
  })

  it('deletes a cell', async () => {
    const nb = makeNotebook([
      { id: 'c1', cell_type: 'code', source: ['a'], metadata: {} },
      { id: 'c2', cell_type: 'code', source: ['b'], metadata: {} },
    ])
    const fp = join(dir, 'test.ipynb')
    writeFileSync(fp, JSON.stringify(nb))

    const result = await NotebookEditTool.execute(
      { notebook_path: fp, cell_id: 'c1', new_source: '', edit_mode: 'delete' },
      ctx,
    )
    expect(result).toContain('Deleted')

    const updated = JSON.parse(readFileSync(fp, 'utf-8'))
    expect(updated.cells).toHaveLength(1)
    expect(updated.cells[0].id).toBe('c2')
  })

  it('errors for missing notebook', async () => {
    const result = await NotebookEditTool.execute(
      { notebook_path: join(dir, 'nope.ipynb'), new_source: 'x' },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })

  it('errors for invalid JSON', async () => {
    const fp = join(dir, 'bad.ipynb')
    writeFileSync(fp, 'not json')
    const result = await NotebookEditTool.execute(
      { notebook_path: fp, new_source: 'x' },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('Invalid JSON'), isError: true })
  })

  it('errors for missing cells array', async () => {
    const fp = join(dir, 'nocells.ipynb')
    writeFileSync(fp, JSON.stringify({ metadata: {} }))
    const result = await NotebookEditTool.execute(
      { notebook_path: fp, new_source: 'x' },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('no cells'), isError: true })
  })

  it('errors for missing cell_id in replace mode', async () => {
    const nb = makeNotebook([{ id: 'c1', cell_type: 'code', source: ['a'], metadata: {} }])
    const fp = join(dir, 'test.ipynb')
    writeFileSync(fp, JSON.stringify(nb))

    const result = await NotebookEditTool.execute(
      { notebook_path: fp, new_source: 'x', edit_mode: 'replace' },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('cell_id is required'), isError: true })
  })

  it('errors for non-existent cell_id', async () => {
    const nb = makeNotebook([{ id: 'c1', cell_type: 'code', source: ['a'], metadata: {} }])
    const fp = join(dir, 'test.ipynb')
    writeFileSync(fp, JSON.stringify(nb))

    const result = await NotebookEditTool.execute(
      { notebook_path: fp, cell_id: 'nope', new_source: 'x', edit_mode: 'replace' },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })
})

// ─── WebFetchTool ──────────────────────────────────────────────────────────

describe('WebFetchTool', () => {
  it('handles fetch error gracefully', async () => {
    const result = await WebFetchTool.execute(
      { url: 'http://localhost:1/', prompt: 'test' },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('Error fetching'), isError: true })
  })
})
