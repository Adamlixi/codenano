/**
 * BashTool — Execute shell commands.
 *
 * Extracted from codenano: src/tools/BashTool/BashTool.tsx
 *
 * Simplified: no sandbox, no background tasks, no sed-edit preview.
 * For production use, wrap this with permission checks and sandboxing.
 */

import { z } from 'zod'
import { execSync, exec } from 'child_process'
import { defineTool } from '../tool-builder.js'

const MAX_TIMEOUT_MS = 600_000 // 10 minutes
const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes

const inputSchema = z.object({
  command: z.string().describe('The command to execute'),
  timeout: z
    .number()
    .optional()
    .describe(`Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS})`),
  description: z
    .string()
    .optional()
    .describe('Clear, concise description of what this command does in active voice.'),
  run_in_background: z
    .boolean()
    .optional()
    .describe('Set to true to run this command in the background.'),
})

export type BashInput = z.infer<typeof inputSchema>

export const BashTool = defineTool({
  name: 'Bash',
  description:
    'Executes a given bash command and returns its output. The working directory persists between commands.',
  input: inputSchema,

  isReadOnly(input) {
    // Heuristic: read-only if it's a common read command
    const readOnlyPrefixes = [
      'ls',
      'cat',
      'head',
      'tail',
      'grep',
      'find',
      'which',
      'echo',
      'pwd',
      'date',
      'env',
      'git status',
      'git log',
      'git diff',
      'git show',
      'git branch',
    ]
    const cmd = input.command.trim()
    return readOnlyPrefixes.some(p => cmd.startsWith(p))
  },

  isConcurrencySafe(input) {
    const readOnlyPrefixes = [
      'ls',
      'cat',
      'head',
      'tail',
      'grep',
      'find',
      'which',
      'echo',
      'pwd',
      'date',
      'env',
      'git status',
      'git log',
      'git diff',
      'git show',
      'git branch',
    ]
    const cmd = input.command.trim()
    return readOnlyPrefixes.some(p => cmd.startsWith(p))
  },

  async execute(input) {
    const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

    if (input.run_in_background) {
      return new Promise<string>(resolve => {
        const child = exec(input.command, {
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          shell: process.env.SHELL || '/bin/bash',
        })

        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', d => {
          stdout += d
        })
        child.stderr?.on('data', d => {
          stderr += d
        })

        // Return immediately with PID
        resolve(`Background process started (PID: ${child.pid})`)
      })
    }

    try {
      const result = execSync(input.command, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.env.SHELL || '/bin/bash',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return result
    } catch (err: any) {
      const stdout = err.stdout ?? ''
      const stderr = err.stderr ?? ''
      const exitCode = err.status ?? 1
      const output = [stdout, stderr].filter(Boolean).join('\n')
      return {
        content: output || `Command failed with exit code ${exitCode}`,
        isError: exitCode !== 0,
      }
    }
  },
})
