/**
 * 运行 Query Tracking 示例
 */

import { createAgent } from '../src/index.js'

async function runExample() {
  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are a helpful assistant.',
  })

  console.log('=== Query Tracking Example ===\n')

  for await (const event of agent.stream('Say hello in one sentence')) {
    if (event.type === 'query_start') {
      console.log('✓ Query started')
      console.log('  Chain ID:', event.queryTracking.chainId)
      console.log('  Depth:', event.queryTracking.depth)
      console.log()
    }

    if (event.type === 'text') {
      process.stdout.write(event.text)
    }

    if (event.type === 'result') {
      console.log('\n\n✓ Query completed')
      console.log('  Chain ID:', event.result.queryTracking.chainId)
      console.log('  Depth:', event.result.queryTracking.depth)
      console.log('  Duration:', event.result.durationMs, 'ms')
    }
  }
}

runExample().catch(console.error)
