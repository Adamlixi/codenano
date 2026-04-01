/**
 * E2E: Streaming with tool calls — see every event in real time.
 *
 * Run: npx tsx examples/e2e-streaming-with-tools.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent, coreTools } from '../src/index.js'

async function main() {
  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
    ...(process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_USE_BEDROCK && { provider: 'anthropic' as const }),
    tools: coreTools(),
    systemPrompt: 'You are a helpful assistant. Use tools when needed. Be concise.',
    maxTurns: 5,
  })

  const cwd = process.cwd()
  console.log('Streaming agent with tool calls:\n')

  let toolCount = 0
  let textLength = 0

  for await (const event of agent.stream(
    `Read the file ${cwd}/package.json and tell me the project name and version.`
  )) {
    switch (event.type) {
      case 'turn_start':
        console.log(`\n=== Turn ${event.turnNumber} ===`)
        break
      case 'text':
        process.stdout.write(event.text)
        textLength += event.text.length
        break
      case 'tool_use':
        toolCount++
        console.log(`\n  >> Tool: ${event.toolName}`)
        console.log(`     Input: ${JSON.stringify(event.input).slice(0, 100)}`)
        break
      case 'tool_result':
        const preview = event.output.slice(0, 80).replace(/\n/g, ' ')
        console.log(`  << Result: ${preview}${event.output.length > 80 ? '...' : ''}`)
        if (event.isError) console.log(`     ERROR!`)
        break
      case 'turn_end':
        console.log(`\n  -- Turn ended: ${event.stopReason}`)
        break
      case 'result':
        console.log(`\n\n--- Summary ---`)
        console.log(`  Turns: ${event.result.numTurns}`)
        console.log(`  Tools called: ${toolCount}`)
        console.log(`  Output chars: ${textLength}`)
        console.log(`  Tokens: ${event.result.usage.inputTokens + event.result.usage.outputTokens}`)
        console.log(`  Duration: ${event.result.durationMs}ms`)
        break
      case 'error':
        console.error(`\n  ERROR: ${event.error.message}`)
        break
    }
  }
}

main().catch(console.error)
