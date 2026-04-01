/**
 * Agent with tools example — file system tools.
 *
 * Run: npx tsx examples/with-tools.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import fs from 'fs'
import path from 'path'
import { createAgent, defineTool } from '../src/index.js'
import { z } from 'zod'

// Define tools
const listFiles = defineTool({
  name: 'ListFiles',
  description: 'List files in a directory',
  input: z.object({
    directory: z.string().describe('Directory path to list'),
  }),
  execute: async ({ directory }) => {
    const files = fs.readdirSync(directory)
    return files.join('\n')
  },
  isReadOnly: true,
  isConcurrencySafe: true,
})

const readFile = defineTool({
  name: 'ReadFile',
  description: 'Read a file from the filesystem',
  input: z.object({
    path: z.string().describe('Absolute or relative file path'),
  }),
  execute: async ({ path: filePath }) => {
    return fs.readFileSync(filePath, 'utf-8')
  },
  isReadOnly: true,
  isConcurrencySafe: true,
})

// Create agent
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: [listFiles, readFile],
  systemPrompt: 'You are a helpful file system assistant. Use the tools available to answer questions about files.',
  maxTurns: 10,
})

async function main() {
  const cwd = process.cwd()
  console.log(`Working directory: ${cwd}\n`)

  const result = await agent.ask(
    `List the files in ${cwd} and read the package.json if it exists. Summarize what this project is.`
  )

  console.log(result.text)
  console.log(`\n--- ${result.numTurns} turns, ${result.durationMs}ms ---`)
}

main().catch(console.error)
