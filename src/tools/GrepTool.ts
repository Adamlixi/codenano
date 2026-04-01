/**
 * GrepTool — Search file contents with regex (ripgrep).
 *
 * Extracted from codenano: src/tools/GrepTool/GrepTool.ts
 */

import { z } from 'zod'
import { execSync } from 'child_process'
import path from 'path'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  pattern: z.string().describe('The regular expression pattern to search for in file contents'),
  path: z.string().optional().describe('File or directory to search in. Defaults to current working directory.'),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.js", "**/*.tsx")'),
  type: z.string().optional().describe('File type to search (e.g. "js", "py", "rust", "go", "java")'),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .optional()
    .describe('Output mode: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts'),
  '-B': z.number().optional().describe('Number of lines to show before each match'),
  '-A': z.number().optional().describe('Number of lines to show after each match'),
  '-C': z.number().optional().describe('Number of lines to show before and after each match'),
  context: z.number().optional().describe('Alias for -C'),
  '-n': z.boolean().optional().describe('Show line numbers in output (defaults to true)'),
  '-i': z.boolean().optional().describe('Case insensitive search'),
  head_limit: z
    .number()
    .optional()
    .describe('Limit output to first N lines/entries. Defaults to 250.'),
  offset: z.number().optional().describe('Skip first N lines/entries before applying head_limit'),
  multiline: z.boolean().optional().describe('Enable multiline mode where . matches newlines'),
})

export type GrepInput = z.infer<typeof inputSchema>

export const GrepTool = defineTool({
  name: 'Grep',
  description: 'A powerful search tool built on ripgrep. Supports full regex syntax, file type filtering, and multiple output modes.',
  input: inputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input) {
    const searchPath = input.path ? path.resolve(input.path) : process.cwd()
    const mode = input.output_mode ?? 'files_with_matches'
    const limit = input.head_limit ?? 250

    // Build rg command
    const args: string[] = ['rg']

    // Output mode
    if (mode === 'files_with_matches') args.push('-l')
    else if (mode === 'count') args.push('-c')

    // Context
    const ctx = input['-C'] ?? input.context
    if (ctx !== undefined) args.push('-C', String(ctx))
    if (input['-B'] !== undefined) args.push('-B', String(input['-B']))
    if (input['-A'] !== undefined) args.push('-A', String(input['-A']))

    // Flags
    if (input['-i']) args.push('-i')
    if (input['-n'] !== false && mode === 'content') args.push('-n')
    if (input.multiline) args.push('-U', '--multiline-dotall')

    // Filters
    if (input.glob) args.push('--glob', input.glob)
    if (input.type) args.push('--type', input.type)

    // Pattern and path
    args.push('--', input.pattern, searchPath)

    try {
      let result = execSync(args.join(' '), {
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      })

      // Apply offset and limit
      let lines = result.split('\n')
      if (input.offset) lines = lines.slice(input.offset)
      if (limit > 0) lines = lines.slice(0, limit)
      result = lines.join('\n').trimEnd()

      return result || `No matches found for pattern "${input.pattern}"`
    } catch (err: any) {
      // rg exits with code 1 when no matches found
      if (err.status === 1) {
        return `No matches found for pattern "${input.pattern}"`
      }
      // rg exits with code 2 on errors
      if (err.status === 2) {
        // Fallback to grep if rg not available
        try {
          const grepArgs = ['grep', '-r']
          if (input['-i']) grepArgs.push('-i')
          if (input['-n'] !== false && mode === 'content') grepArgs.push('-n')
          if (mode === 'files_with_matches') grepArgs.push('-l')
          if (mode === 'count') grepArgs.push('-c')
          grepArgs.push('--', input.pattern, searchPath)

          const fallback = execSync(grepArgs.join(' '), {
            encoding: 'utf-8',
            timeout: 30_000,
          })
          return fallback.trimEnd() || `No matches found for pattern "${input.pattern}"`
        } catch {
          return `No matches found for pattern "${input.pattern}"`
        }
      }
      return { content: `Error searching: ${err.message}`, isError: true }
    }
  },
})
