/**
 * tool-builder.ts — defineTool() helper
 *
 * Provides an ergonomic way for developers to define tools
 * with Zod schemas and execute functions.
 */

import type { ZodType } from 'zod'
import type { ToolDef, ToolContext, ToolOutput } from './types.js'

/**
 * Define a tool for the agent to use.
 *
 * @example
 * ```typescript
 * import { defineTool } from 'agent-core'
 * import { z } from 'zod'
 *
 * const readFile = defineTool({
 *   name: 'ReadFile',
 *   description: 'Read a file from the filesystem',
 *   input: z.object({
 *     path: z.string().describe('Absolute path to the file'),
 *   }),
 *   execute: async (input) => {
 *     return fs.readFileSync(input.path, 'utf-8')
 *   },
 *   isReadOnly: true,
 *   isConcurrencySafe: true,
 * })
 * ```
 */
export function defineTool<TInput>(params: {
  /** Unique tool name */
  name: string
  /** Description shown to the model */
  description: string
  /** Zod schema for input validation */
  input: ZodType<TInput>
  /** Execute function — receives validated input */
  execute: (input: TInput, context: ToolContext) => Promise<ToolOutput>
  /** Whether this tool only reads data (default: false) */
  isReadOnly?: boolean | ((input: TInput) => boolean)
  /** Whether safe to run concurrently (default: same as isReadOnly) */
  isConcurrencySafe?: boolean | ((input: TInput) => boolean)
}): ToolDef<TInput> {
  return {
    name: params.name,
    description: params.description,
    input: params.input,
    execute: params.execute,
    isReadOnly: params.isReadOnly ?? false,
    isConcurrencySafe: params.isConcurrencySafe ?? params.isReadOnly ?? false,
  }
}
