/**
 * E2E: Permission control — agent adapts when tools are denied.
 *
 * Run: npx tsx examples/e2e-permission-control.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent, defineTool, coreTools } from '../src/index.js'
import { z } from 'zod'

async function main() {
  // Track permission decisions for logging
  const decisions: { tool: string; action: string }[] = []

  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
    ...(process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_USE_BEDROCK && { provider: 'anthropic' as const }),
    tools: coreTools(),
    systemPrompt: 'You are a helpful assistant. Use tools to complete tasks. Be concise.',
    maxTurns: 8,
    canUseTool: (toolName, input) => {
      // Allow read-only tools
      if (['Read', 'Glob', 'Grep'].includes(toolName)) {
        decisions.push({ tool: toolName, action: 'allow' })
        return { behavior: 'allow' }
      }

      // Deny write operations
      if (['Edit', 'Write', 'Bash'].includes(toolName)) {
        decisions.push({ tool: toolName, action: 'deny' })
        return {
          behavior: 'deny',
          message: `${toolName} is not allowed in read-only mode. Only Read, Glob, and Grep are permitted.`,
        }
      }

      return { behavior: 'allow' }
    },
  })

  const cwd = process.cwd()
  console.log('Permission control demo (read-only mode):\n')

  // This prompt will cause the agent to try reading (allowed) and then
  // potentially writing (denied) — it should adapt gracefully
  const result = await agent.ask(
    `Read ${cwd}/package.json. Then try to create a file called /tmp/agent-test.txt with the project name. If you can't write, just tell me what the project name is.`
  )

  console.log(result.text)
  console.log(`\n--- Permission log ---`)
  for (const d of decisions) {
    console.log(`  ${d.action === 'allow' ? 'ALLOW' : 'DENY '} ${d.tool}`)
  }
  console.log(`\n${result.numTurns} turns, ${result.durationMs}ms`)
}

main().catch(console.error)
