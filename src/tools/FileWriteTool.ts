/**
 * FileWriteTool — Create or overwrite files.
 *
 * Extracted from codenano: src/tools/FileWriteTool/FileWriteTool.ts
 */

import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  file_path: z
    .string()
    .describe('The absolute path to the file to write (must be absolute, not relative)'),
  content: z.string().describe('The content to write to the file'),
})

export type FileWriteInput = z.infer<typeof inputSchema>

export const FileWriteTool = defineTool({
  name: 'Write',
  description:
    'Writes a file to the local filesystem. This tool will overwrite the existing file if there is one at the provided path.',
  input: inputSchema,

  async execute(input) {
    const filePath = path.resolve(input.file_path)

    // Ensure parent directory exists
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const existed = fs.existsSync(filePath)
    fs.writeFileSync(filePath, input.content, 'utf-8')

    const lines = input.content.split('\n').length
    return `Successfully ${existed ? 'overwrote' : 'created'} ${filePath} (${lines} lines)`
  },
})
