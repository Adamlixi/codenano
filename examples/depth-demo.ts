/**
 * Query Tracking Depth Example
 * 演示不同深度的 queryTracking
 */

import { createAgent } from '../src/index.js'

async function demonstrateDepth() {
  console.log('=== Query Tracking Depth Demo ===\n')

  // 示例 1: Session 中的深度递增
  console.log('📊 Example 1: Session Depth Increment\n')

  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    model: 'claude-sonnet-4-6',
  })

  const session = agent.session()

  // Turn 1 - Depth 0
  console.log('Turn 1:')
  for await (const event of session.stream('My name is Alice')) {
    if (event.type === 'query_start') {
      console.log(`  ✓ Query started - Chain: ${event.queryTracking.chainId.slice(0, 8)}... Depth: ${event.queryTracking.depth}`)
    }
    if (event.type === 'result') {
      console.log(`  ✓ Completed - Depth: ${event.result.queryTracking.depth}\n`)
    }
  }

  // Turn 2 - Depth 1
  console.log('Turn 2:')
  for await (const event of session.stream('What is my name?')) {
    if (event.type === 'query_start') {
      console.log(`  ✓ Query started - Chain: ${event.queryTracking.chainId.slice(0, 8)}... Depth: ${event.queryTracking.depth}`)
    }
    if (event.type === 'result') {
      console.log(`  ✓ Completed - Depth: ${event.result.queryTracking.depth}\n`)
    }
  }

  // Turn 3 - Depth 2
  console.log('Turn 3:')
  for await (const event of session.stream('Repeat it')) {
    if (event.type === 'query_start') {
      console.log(`  ✓ Query started - Chain: ${event.queryTracking.chainId.slice(0, 8)}... Depth: ${event.queryTracking.depth}`)
    }
    if (event.type === 'result') {
      console.log(`  ✓ Completed - Depth: ${event.result.queryTracking.depth}\n`)
    }
  }
}

demonstrateDepth().catch(console.error)
