/**
 * LSPTool — Code intelligence via Language Server Protocol.
 *
 * Extracted from Claude Code: src/tools/LSPTool/LSPTool.ts
 *
 * Note: This is a schema-only stub. The actual LSP implementation requires
 * a running language server. SDK users should provide their own LSP client
 * connection via the execute function.
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  operation: z
    .enum([
      'goToDefinition',
      'findReferences',
      'hover',
      'documentSymbol',
      'workspaceSymbol',
      'goToImplementation',
      'prepareCallHierarchy',
      'incomingCalls',
      'outgoingCalls',
    ])
    .describe('The LSP operation to perform'),
  filePath: z.string().describe('The absolute or relative path to the file'),
  line: z.number().int().positive().describe('The line number (1-based)'),
  character: z.number().int().positive().describe('The character offset (1-based)'),
})

export type LSPInput = z.infer<typeof inputSchema>

export const LSPTool = defineTool({
  name: 'LSP',
  description: 'Code intelligence tool providing definitions, references, hover info, and symbols via the Language Server Protocol.',
  input: inputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(_input) {
    return {
      content: 'LSPTool requires a language server connection. Override the execute function with your own LSP client integration.',
      isError: true,
    }
  },
})
