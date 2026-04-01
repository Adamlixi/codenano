/**
 * Basic agent example — no tools, just conversation.
 *
 * Run: npx tsx examples/basic.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent } from '../src/index.js'

async function main() {
  const agent = createAgent({
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are a helpful assistant. Be concise.',
  })

  console.log('Asking agent...\n')
  const result = await agent.ask('What are the 3 most important design patterns in software engineering? One sentence each.')

  console.log(result.text)
  console.log(`\n--- ${result.numTurns} turn(s), ${result.usage.inputTokens + result.usage.outputTokens} tokens, ${result.durationMs}ms ---`)
}

main().catch(console.error)
