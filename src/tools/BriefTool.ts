/**
 * BriefTool — Send a message to the user.
 *
 * Extracted from Claude Code: src/tools/BriefTool/BriefTool.ts
 *
 * In Claude Code, this renders a message in the terminal UI.
 * In the SDK, it simply returns the message as output.
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  message: z.string().describe('The message to send to the user (supports markdown)'),
  attachments: z
    .array(z.string())
    .optional()
    .describe('Optional file paths to attach'),
  status: z
    .enum(['normal', 'proactive'])
    .optional()
    .describe('Use "proactive" for unsolicited updates'),
})

export type BriefInput = z.infer<typeof inputSchema>

export const BriefTool = defineTool({
  name: 'Brief',
  description: 'Send a message to the user — the primary visible output channel for the agent.',
  input: inputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input) {
    return input.message
  },
})
