/**
 * Streaming agent example — see events in real time.
 *
 * Run: npx tsx examples/streaming.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent, defineTool } from '../src/index.js'
import { z } from 'zod'

const calculator = defineTool({
  name: 'Calculate',
  description: 'Evaluate a mathematical expression',
  input: z.object({
    expression: z.string().describe('Math expression to evaluate (e.g. "2 + 3 * 4")'),
  }),
  execute: async ({ expression }) => {
    // Simple eval for demo — in production, use a safe math parser
    try {
      const result = Function(`"use strict"; return (${expression})`)()
      return String(result)
    } catch {
      return { content: `Cannot evaluate: ${expression}`, isError: true }
    }
  },
  isReadOnly: true,
})

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: [calculator],
  systemPrompt: 'You are a math assistant. Use the Calculate tool for any arithmetic.',
})

async function main() {
  console.log('Streaming agent response:\n')

  for await (const event of agent.stream(
    'What is (17 * 23) + (45 / 9)? Show your work.'
  )) {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.text)
        break
      case 'tool_use':
        console.log(`\n  [tool] ${event.toolName}(${JSON.stringify(event.input)})`)
        break
      case 'tool_result':
        console.log(`  [result] ${event.output}`)
        break
      case 'turn_start':
        if (event.turnNumber > 1) console.log(`\n--- Turn ${event.turnNumber} ---`)
        break
      case 'result':
        console.log(`\n\n--- Done: ${event.result.numTurns} turns, ${event.result.durationMs}ms ---`)
        break
    }
  }
}

main().catch(console.error)
