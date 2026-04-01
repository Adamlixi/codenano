/**
 * FileReadTool — Read files, images, PDFs, notebooks from disk.
 *
 * Extracted from codenano: src/tools/FileReadTool/FileReadTool.ts
 */

import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to read'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'The line number to start reading from (0-based). Only provide if the file is too large to read at once',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('The number of lines to read. Only provide if the file is too large to read at once'),
})

export type FileReadInput = z.infer<typeof inputSchema>

export const FileReadTool = defineTool({
  name: 'Read',
  description:
    'Reads a file from the local filesystem. Assume this tool is able to read all files on the machine.',
  input: inputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input) {
    const filePath = path.resolve(input.file_path)

    if (!fs.existsSync(filePath)) {
      return { content: `Error: File not found: ${filePath}`, isError: true }
    }

    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      return {
        content: `Error: ${filePath} is a directory, not a file. Use Bash with ls to list directory contents.`,
        isError: true,
      }
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n')

    const offset = input.offset ?? 0
    const limit = input.limit ?? lines.length
    const sliced = lines.slice(offset, offset + limit)

    // Format with line numbers (cat -n style)
    const numbered = sliced.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
    return numbered
  },
})
