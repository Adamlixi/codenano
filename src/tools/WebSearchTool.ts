/**
 * WebSearchTool — Search the web.
 *
 * Extracted from Claude Code: src/tools/WebSearchTool/WebSearchTool.ts
 *
 * Note: This is a stub implementation. In Claude Code, web search uses
 * Anthropic's server-side web search API. SDK users should provide their
 * own search backend (e.g. Brave, Serper, Tavily) via the execute function.
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  query: z.string().min(2).describe('The search query to use'),
  allowed_domains: z
    .array(z.string())
    .optional()
    .describe('Only include results from these domains'),
  blocked_domains: z
    .array(z.string())
    .optional()
    .describe('Never include results from these domains'),
})

export type WebSearchInput = z.infer<typeof inputSchema>

export const WebSearchTool = defineTool({
  name: 'WebSearch',
  description: 'Searches the web for real-time information. Returns search results with titles, URLs, and snippets.',
  input: inputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(_input) {
    return {
      content: 'WebSearchTool requires a search backend. Override the execute function with your own search API integration (e.g. Brave, Serper, Tavily).',
      isError: true,
    }
  },
})
