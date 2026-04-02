/**
 * E2E: Memory system demonstration
 * Run: npx tsx examples/e2e-memory.ts
 */

import { createAgent, saveMemory } from '../src/index.js'

async function main() {
  console.log('=== Memory System Demo ===\n')

  // Save a user preference memory
  console.log('1. Saving user preference memory...')
  saveMemory({
    name: 'user_preferences',
    description: 'User prefers concise responses without verbose explanations',
    type: 'user',
    content: 'The user has requested that responses be brief and to the point, avoiding lengthy explanations unless specifically asked.',
  })

  // Save a feedback memory
  console.log('2. Saving feedback memory...')
  saveMemory({
    name: 'code_style',
    description: 'User prefers functional programming style',
    type: 'feedback',
    content: 'User has indicated preference for functional programming patterns over class-based approaches. Use pure functions and avoid mutable state when possible.',
  })

  console.log('3. Creating agent with memory enabled...\n')

  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    memory: {
      autoLoad: true,
    },
  })

  console.log('4. Asking agent a question (memory should influence response)...\n')
  const result = await agent.ask('Explain how async/await works in JavaScript')

  console.log('Response:')
  console.log(result.text)
  console.log(`\n--- ${result.numTurns} turns, ${result.durationMs}ms ---`)
}

main().catch(console.error)
