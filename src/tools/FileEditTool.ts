/**
 * FileEditTool — Perform exact string replacements in files.
 *
 * Extracted from codenano: src/tools/FileEditTool/FileEditTool.ts
 */

import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to modify'),
  old_string: z.string().describe('The text to replace'),
  new_string: z.string().describe('The text to replace it with (must be different from old_string)'),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace all occurrences of old_string (default false)'),
})

export type FileEditInput = z.infer<typeof inputSchema>

export const FileEditTool = defineTool({
  name: 'Edit',
  description: 'Performs exact string replacements in files. The edit will FAIL if old_string is not unique in the file (unless replace_all is true).',
  input: inputSchema,

  async execute(input) {
    const filePath = path.resolve(input.file_path)

    if (!fs.existsSync(filePath)) {
      return { content: `Error: File not found: ${filePath}`, isError: true }
    }

    const content = fs.readFileSync(filePath, 'utf-8')

    if (input.old_string === input.new_string) {
      return { content: 'Error: old_string and new_string are identical', isError: true }
    }

    if (!content.includes(input.old_string)) {
      return { content: `Error: old_string not found in ${filePath}`, isError: true }
    }

    if (!input.replace_all) {
      // Check uniqueness
      const firstIdx = content.indexOf(input.old_string)
      const secondIdx = content.indexOf(input.old_string, firstIdx + 1)
      if (secondIdx !== -1) {
        return {
          content: `Error: old_string appears multiple times in ${filePath}. Use replace_all: true or provide more context to make it unique.`,
          isError: true,
        }
      }
    }

    const updated = input.replace_all
      ? content.split(input.old_string).join(input.new_string)
      : content.replace(input.old_string, input.new_string)

    fs.writeFileSync(filePath, updated, 'utf-8')

    // Count replacements
    const count = input.replace_all
      ? content.split(input.old_string).length - 1
      : 1

    return `Successfully edited ${filePath} (${count} replacement${count > 1 ? 's' : ''})`
  },
})
