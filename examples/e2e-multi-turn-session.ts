/**
 * E2E: Multi-turn session — agent remembers context across turns.
 *
 * Run: npx tsx examples/e2e-multi-turn-session.ts
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import { createAgent, defineTool } from '../src/index.js'
import { z } from 'zod'
import fs from 'fs'
import os from 'os'
import path from 'path'

// In-memory "database" for the demo
const db = new Map<string, { name: string; email: string }>()

const createUser = defineTool({
  name: 'CreateUser',
  description: 'Create a new user in the database',
  input: z.object({
    id: z.string().describe('User ID'),
    name: z.string().describe('User name'),
    email: z.string().describe('User email'),
  }),
  async execute({ id, name, email }) {
    db.set(id, { name, email })
    return `User ${id} created: ${name} <${email}>`
  },
})

const getUser = defineTool({
  name: 'GetUser',
  description: 'Look up a user by ID',
  input: z.object({
    id: z.string().describe('User ID to look up'),
  }),
  async execute({ id }) {
    const user = db.get(id)
    if (!user) return { content: `User ${id} not found`, isError: true }
    return JSON.stringify(user)
  },
  isReadOnly: true,
  isConcurrencySafe: true,
})

const listUsers = defineTool({
  name: 'ListUsers',
  description: 'List all users in the database',
  input: z.object({}),
  async execute() {
    if (db.size === 0) return 'No users in database'
    return [...db.entries()]
      .map(([id, u]) => `${id}: ${u.name} <${u.email}>`)
      .join('\n')
  },
  isReadOnly: true,
  isConcurrencySafe: true,
})

async function main() {
  const agent = createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
    ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
    ...(process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_USE_BEDROCK && { provider: 'anthropic' as const }),
    tools: [createUser, getUser, listUsers],
    systemPrompt: 'You are a database assistant. Use tools to manage users. Be concise.',
    maxTurns: 5,
  })

  const session = agent.session()

  // Turn 1: Create users
  console.log('--- Turn 1: Create users ---')
  const r1 = await session.send('Create two users: alice (id: u1, email: alice@example.com) and bob (id: u2, email: bob@example.com)')
  console.log(r1.text)
  console.log(`  [${r1.numTurns} turns, ${r1.durationMs}ms]\n`)

  // Turn 2: Query — agent should remember what it just did
  console.log('--- Turn 2: Query users ---')
  const r2 = await session.send('List all users and tell me how many there are')
  console.log(r2.text)
  console.log(`  [${r2.numTurns} turns, ${r2.durationMs}ms]\n`)

  // Turn 3: Cross-reference — agent needs context from both turns
  console.log('--- Turn 3: Cross-reference ---')
  const r3 = await session.send('Look up the first user you created and tell me their email')
  console.log(r3.text)
  console.log(`  [${r3.numTurns} turns, ${r3.durationMs}ms]\n`)

  console.log(`Session history: ${session.history.length} messages`)
}

main().catch(console.error)
