/**
 * SkillTool — Invoke saved skills (slash commands).
 *
 * Extracted from codenano: src/tools/SkillTool/SkillTool.ts
 *
 * This is a schema-only stub. The actual implementation requires a
 * skill registry. SDK users should provide their own skill loader.
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  skill: z.string().describe('The skill name (e.g., "commit", "review-pr", "pdf")'),
  args: z.string().optional().describe('Optional arguments for the skill'),
})

export type SkillInput = z.infer<typeof inputSchema>

export const SkillTool = defineTool({
  name: 'Skill',
  description: 'Execute a skill within the current conversation. Skills provide specialized capabilities and domain knowledge.',
  input: inputSchema,

  async execute(_input) {
    return {
      content: 'SkillTool requires a skill registry. Override the execute function to connect to your skill loader.',
      isError: true,
    }
  },
})
