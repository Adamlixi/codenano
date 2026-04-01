/**
 * E2E: Stop hook — force the agent to include specific content before finishing.
 *
 * Run: npx tsx examples/e2e-stop-hook.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent, defineTool } from '../src/index.js'
import { z } from 'zod'

async function main() {
  let hookFired = false

  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
    ...(process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_USE_BEDROCK && { provider: 'anthropic' as const }),
    systemPrompt: 'You are a task assistant. After completing a task, always end your response with "STATUS: DONE".',
    maxTurns: 5,
    onTurnEnd: ({ lastResponse }) => {
      if (!lastResponse.includes('STATUS: DONE')) {
        if (!hookFired) {
          hookFired = true
          console.log('  [Hook] Response missing STATUS marker — nudging agent\n')
          return { continueWith: 'You forgot to include "STATUS: DONE" at the end. Please add it.' }
        }
        // Only try once to avoid infinite loop
        return {}
      }
      console.log('  [Hook] STATUS: DONE detected — allowing stop\n')
      return {}
    },
  })

  console.log('Stop hook demo:\n')

  const result = await agent.ask('Tell me 3 tips for writing clean code.')

  console.log(result.text)
  console.log(`\n--- ${result.numTurns} turns, ${result.durationMs}ms ---`)
  console.log(`Hook fired: ${hookFired}`)
}

main().catch(console.error)
