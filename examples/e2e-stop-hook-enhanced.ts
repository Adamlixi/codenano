/**
 * E2E: Enhanced Stop Hook — test preventContinuation and retry limit
 *
 * Run: npx tsx examples/e2e-stop-hook-enhanced.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent } from '../src/index.js'

async function main() {
  console.log('=== Test 1: preventContinuation ===\n')

  const agent1 = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    maxTurns: 5,
    onTurnEnd: ({ lastResponse }) => {
      console.log('  [Hook] Checking response...')
      if (lastResponse.includes('stop now')) {
        console.log('  [Hook] Found "stop now" — preventing continuation\n')
        return { preventContinuation: true }
      }
      return {}
    },
  })

  const result1 = await agent1.ask('Say "stop now" in your response.')
  console.log(`Result: ${result1.text.substring(0, 100)}...`)
  console.log(`Stop reason: ${result1.stopReason}`)
  console.log(`Turns: ${result1.numTurns}\n`)

  console.log('=== Test 2: Retry limit ===\n')

  let retryCount = 0
  const agent2 = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    maxTurns: 10,
    onTurnEnd: ({ lastResponse }) => {
      retryCount++
      console.log(`  [Hook] Retry ${retryCount}: Response missing marker`)
      // Always return continueWith to test retry limit
      return { continueWith: 'Add "MARKER" to your response.' }
    },
  })

  const result2 = await agent2.ask('Say hello.')
  console.log(`Stop reason: ${result2.stopReason}`)
  console.log(`Total retries: ${retryCount}`)
  console.log(`Turns: ${result2.numTurns}`)
}

main().catch(console.error)
