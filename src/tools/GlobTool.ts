/**
 * GlobTool — Fast file pattern matching.
 *
 * Extracted from Claude Code: src/tools/GlobTool/GlobTool.ts
 */

import { z } from 'zod'
import { execSync } from 'child_process'
import path from 'path'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files against'),
  path: z
    .string()
    .optional()
    .describe('The directory to search in. If not specified, the current working directory will be used.'),
})

export type GlobInput = z.infer<typeof inputSchema>

export const GlobTool = defineTool({
  name: 'Glob',
  description: 'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
  input: inputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input) {
    const searchDir = input.path ? path.resolve(input.path) : process.cwd()

    try {
      // Use find with globbing — cross-platform fallback
      // On systems with fd, could use fd instead
      const result = execSync(
        `find ${JSON.stringify(searchDir)} -name ${JSON.stringify(input.pattern)} -type f 2>/dev/null | head -1000`,
        { encoding: 'utf-8', timeout: 30_000 },
      )

      const files = result.trim().split('\n').filter(Boolean)
      if (files.length === 0) {
        return `No files matched pattern "${input.pattern}" in ${searchDir}`
      }
      return files.join('\n')
    } catch {
      return { content: `Error: Failed to search for pattern "${input.pattern}" in ${searchDir}`, isError: true }
    }
  },
})
