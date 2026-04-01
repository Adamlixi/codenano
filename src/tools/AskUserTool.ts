/**
 * AskUserQuestionTool — Prompt the user with questions.
 *
 * Extracted from codenano: src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx
 *
 * This is a schema-only stub. The actual implementation requires a UI
 * layer to display questions and collect answers. SDK users should
 * provide their own user interaction mechanism.
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  question: z.string().describe('The question to ask the user'),
})

export type AskUserInput = z.infer<typeof inputSchema>

export const AskUserTool = defineTool({
  name: 'AskUserQuestion',
  description: 'Ask the user a question and wait for their response. Use this when you need clarification or input from the user.',
  input: inputSchema,

  async execute(_input) {
    return {
      content: 'AskUserTool requires a UI integration. Override the execute function to connect to your user interaction layer (CLI readline, web UI, etc.).',
      isError: true,
    }
  },
})
