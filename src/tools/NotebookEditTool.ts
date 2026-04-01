/**
 * NotebookEditTool — Edit Jupyter notebook cells (.ipynb).
 *
 * Extracted from codenano: src/tools/NotebookEditTool/NotebookEditTool.ts
 */

import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  notebook_path: z.string().describe('The absolute path to the Jupyter notebook file (.ipynb)'),
  cell_id: z.string().optional().describe('The ID of an existing cell to edit. If not provided with insert mode, inserts at the end.'),
  new_source: z.string().describe('The new source content for the cell'),
  cell_type: z
    .enum(['code', 'markdown'])
    .optional()
    .describe('The type of cell (defaults to "code")'),
  edit_mode: z
    .enum(['replace', 'insert', 'delete'])
    .optional()
    .describe('The type of edit to perform (defaults to "replace")'),
})

export type NotebookEditInput = z.infer<typeof inputSchema>

export const NotebookEditTool = defineTool({
  name: 'NotebookEdit',
  description: 'Edit, insert, or delete cells in a Jupyter notebook (.ipynb file).',
  input: inputSchema,

  async execute(input) {
    const filePath = path.resolve(input.notebook_path)

    if (!fs.existsSync(filePath)) {
      return { content: `Error: Notebook not found: ${filePath}`, isError: true }
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    let notebook: any

    try {
      notebook = JSON.parse(raw)
    } catch {
      return { content: `Error: Invalid JSON in notebook: ${filePath}`, isError: true }
    }

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return { content: `Error: Invalid notebook format (no cells array)`, isError: true }
    }

    const mode = input.edit_mode ?? 'replace'
    const cellType = input.cell_type ?? 'code'
    const sourceLines = input.new_source.split('\n').map((line, i, arr) =>
      i < arr.length - 1 ? line + '\n' : line,
    )

    if (mode === 'insert') {
      const newCell = {
        cell_type: cellType,
        source: sourceLines,
        metadata: {},
        ...(cellType === 'code' ? { execution_count: null, outputs: [] } : {}),
      }

      if (input.cell_id) {
        const idx = notebook.cells.findIndex((c: any) => c.id === input.cell_id)
        if (idx === -1) {
          return { content: `Error: Cell with id "${input.cell_id}" not found`, isError: true }
        }
        notebook.cells.splice(idx + 1, 0, newCell)
      } else {
        notebook.cells.push(newCell)
      }

      fs.writeFileSync(filePath, JSON.stringify(notebook, null, 1) + '\n', 'utf-8')
      return `Inserted new ${cellType} cell in ${filePath}`
    }

    if (!input.cell_id) {
      return { content: `Error: cell_id is required for ${mode} mode`, isError: true }
    }

    const cellIdx = notebook.cells.findIndex((c: any) => c.id === input.cell_id)
    if (cellIdx === -1) {
      return { content: `Error: Cell with id "${input.cell_id}" not found`, isError: true }
    }

    if (mode === 'delete') {
      notebook.cells.splice(cellIdx, 1)
      fs.writeFileSync(filePath, JSON.stringify(notebook, null, 1) + '\n', 'utf-8')
      return `Deleted cell "${input.cell_id}" from ${filePath}`
    }

    // Replace mode
    notebook.cells[cellIdx].source = sourceLines
    if (input.cell_type) {
      notebook.cells[cellIdx].cell_type = input.cell_type
    }

    fs.writeFileSync(filePath, JSON.stringify(notebook, null, 1) + '\n', 'utf-8')
    return `Replaced cell "${input.cell_id}" in ${filePath}`
  },
})
