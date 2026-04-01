/**
 * E2E: Agent with built-in tools — reads, searches, and analyzes a real project.
 *
 * Run: npx tsx examples/e2e-built-in-tools.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent, coreTools } from '../src/index.js'

async function main() {
  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
    ...(process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_USE_BEDROCK && { provider: 'anthropic' as const }),
    tools: coreTools(), // Read, Edit, Write, Glob, Grep, Bash
    systemPrompt: 'You are a helpful coding assistant. Use tools to answer questions about the codebase.',
    maxTurns: 10,
  })

  const cwd = process.cwd()
  console.log(`Working directory: ${cwd}\n`)

  // Ask the agent to explore the project using built-in tools
  console.log('--- Task: Explore project structure ---\n')
  const result = await agent.ask(
    `Explore the project at ${cwd}. Read package.json, then use Grep to find all exported functions in src/index.ts. Give me a brief summary of the project.`
  )

  console.log(result.text)
  console.log(`\n--- ${result.numTurns} turns, ${result.usage.inputTokens + result.usage.outputTokens} tokens, ${result.durationMs}ms ---`)
}

main().catch(console.error)
