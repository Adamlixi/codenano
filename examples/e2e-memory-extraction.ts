/**
 * E2E: Memory extraction strategies demo
 * Run: npx tsx examples/e2e-memory-extraction.ts
 */

import { createAgent } from '../src/index.js'

async function main() {
  console.log('=== Memory Extraction Demo ===\n')

  console.log('1. Creating agent with AUTO extraction strategy...\n')
  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    memory: {
      autoLoad: true,
      extractStrategy: 'auto', // Extract after every turn
    },
  })

  console.log('2. Having a conversation with preferences...\n')
  await agent.ask('I prefer concise responses without verbose explanations.')

  console.log('3. Asking another question...\n')
  const result = await agent.ask('Explain promises in JavaScript')

  console.log('Response:')
  console.log(result.text.substring(0, 200) + '...')
  console.log(`\n--- ${result.numTurns} turns ---`)
  console.log('\nMemories should be extracted in background.')
}

main().catch(console.error)
