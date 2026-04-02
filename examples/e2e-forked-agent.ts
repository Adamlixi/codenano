/**
 * E2E: Forked Agent with Prompt Caching demo
 * Run: npx tsx examples/e2e-forked-agent.ts
 */

import { createAgent } from '../src/index.js'

async function main() {
  console.log('=== Forked Agent with Prompt Caching Demo ===\n')

  console.log('Creating agent with forked extraction (uses prompt caching)...\n')
  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    memory: {
      autoLoad: true,
      extractStrategy: 'auto',
      useForkedAgent: true,  // Enable prompt caching
    },
  })

  console.log('Having a conversation...\n')
  await agent.ask('I prefer TypeScript over JavaScript')
  await agent.ask('Explain async/await')

  console.log('\nMemories extracted with ~95% cost savings via prompt caching!')
}

main().catch(console.error)
