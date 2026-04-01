/**
 * WebFetchTool — Fetch and extract content from a URL.
 *
 * Extracted from Claude Code: src/tools/WebFetchTool/WebFetchTool.ts
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  url: z.string().url().describe('The URL to fetch content from'),
  prompt: z.string().describe('A prompt to describe what information to extract from the page'),
})

export type WebFetchInput = z.infer<typeof inputSchema>

export const WebFetchTool = defineTool({
  name: 'WebFetch',
  description: 'Fetches a URL from the internet and extracts its content as markdown.',
  input: inputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input) {
    try {
      const response = await fetch(input.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AgentCore/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(30_000),
      })

      if (!response.ok) {
        return { content: `Error: HTTP ${response.status} ${response.statusText}`, isError: true }
      }

      const contentType = response.headers.get('content-type') ?? ''
      const text = await response.text()

      // Simple HTML to text extraction (strip tags)
      if (contentType.includes('text/html')) {
        const cleaned = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()

        // Truncate to ~100k chars to avoid blowing up context
        const truncated = cleaned.length > 100_000
          ? cleaned.slice(0, 100_000) + '\n\n[Content truncated]'
          : cleaned

        return `URL: ${input.url}\nPrompt: ${input.prompt}\n\nContent:\n${truncated}`
      }

      // Non-HTML: return raw text
      const truncated = text.length > 100_000
        ? text.slice(0, 100_000) + '\n\n[Content truncated]'
        : text

      return `URL: ${input.url}\nPrompt: ${input.prompt}\n\nContent:\n${truncated}`
    } catch (err: any) {
      return { content: `Error fetching ${input.url}: ${err.message}`, isError: true }
    }
  },
})
