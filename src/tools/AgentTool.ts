/**
 * AgentTool — Spawn sub-agents for parallel or complex tasks.
 *
 * Extracted from codenano: src/tools/AgentTool/AgentTool.tsx
 *
 * This is the schema definition. The actual agent spawning requires
 * integration with createAgent(). SDK users can wire this up to create
 * recursive agent hierarchies.
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const inputSchema = z.object({
  description: z.string().describe('A short (3-5 word) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
  subagent_type: z
    .string()
    .optional()
    .describe('The type of specialized agent to use for this task'),
  model: z
    .enum(['sonnet', 'opus', 'haiku'])
    .optional()
    .describe('Optional model override for this agent'),
  run_in_background: z
    .boolean()
    .optional()
    .describe('Set to true to run this agent in the background'),
  name: z
    .string()
    .optional()
    .describe('Name for the spawned agent. Makes it addressable via SendMessage.'),
  mode: z
    .enum(['default', 'plan', 'bypassPermissions', 'acceptEdits', 'dontAsk', 'auto'])
    .optional()
    .describe('Permission mode for the spawned agent'),
  isolation: z
    .enum(['worktree'])
    .optional()
    .describe('Isolation mode. "worktree" creates a temporary git worktree for the agent.'),
})

export type AgentToolInput = z.infer<typeof inputSchema>

export const AgentTool = defineTool({
  name: 'Agent',
  description:
    'Launch a new agent to handle complex, multi-step tasks autonomously. Each agent runs in its own context with access to tools.',
  input: inputSchema,

  async execute(_input) {
    return {
      content:
        'AgentTool requires agent spawning infrastructure. Override the execute function to integrate with createAgent() for recursive agent hierarchies.',
      isError: true,
    }
  },
})
