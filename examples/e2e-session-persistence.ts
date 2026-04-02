/**
 * E2E: Session persistence — verify JSONL write on persist, reload on resume.
 *
 * This test:
 *   1. Creates a session with persistence, sends messages, verifies JSONL file written
 *   2. Creates a NEW session from the same sessionId, verifies history is restored
 *   3. Sends another message in the resumed session, verifies the model has full context
 *   4. Checks the JSONL file contains all entries via loadSession/listSessions APIs
 *
 * Run:
 *   ANTHROPIC_API_KEY=<key> ANTHROPIC_BASE_URL=<url> npx tsx examples/e2e-session-persistence.ts
 */

import { createAgent, defineTool, loadSession, listSessions } from '../src/index.js'
import { z } from 'zod'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getSessionFilePath } from '../src/session-storage.js'

// ─── Setup ─────────────────────────────────────────────────────────────────

const storageDir = mkdtempSync(join(tmpdir(), 'agent-core-e2e-persist-'))

const noteTool = defineTool({
  name: 'TakeNote',
  description: 'Save a short note. Always use this tool when asked to remember something.',
  input: z.object({ note: z.string().describe('The note content') }),
  async execute({ note }) {
    return `Note saved: "${note}"`
  },
  isReadOnly: false,
})

function makeAgent() {
  return createAgent({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    tools: [noteTool],
    systemPrompt: 'You are a concise assistant. When asked to remember something, use the TakeNote tool. Keep answers short (1-2 sentences).',
    maxTurns: 5,
    persistence: { enabled: true, storageDir },
  })
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`  PASS: ${msg}`)
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  let savedSessionId: string

  // ════════════════════════════════════════════════════════════════════════
  // Step 1: Create a new session, send messages, verify JSONL is written
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== Step 1: New session — send messages & verify JSONL write ===')
  {
    const agent = makeAgent()
    const session = agent.session()
    savedSessionId = session.id
    console.log(`  Session ID: ${savedSessionId}`)

    // Verify JSONL file was created (metadata entry)
    const jsonlPath = getSessionFilePath(savedSessionId, { storageDir })
    assert(existsSync(jsonlPath), 'JSONL file created after session init')

    // Check metadata entry
    const raw = readFileSync(jsonlPath, 'utf-8')
    const firstLine = JSON.parse(raw.split('\n')[0]!)
    assert(firstLine.type === 'metadata', 'First line is metadata entry')
    assert(firstLine.metadata.sessionId === savedSessionId, 'Metadata contains correct sessionId')

    // Send first message
    const r1 = await session.send('Please remember that my secret code is 42. Take a note.')
    console.log(`  Turn 1: "${r1.text.slice(0, 80)}" (${r1.numTurns} turns)`)
    assert(r1.numTurns >= 1, 'Turn 1 completed')

    // Send second message — model should remember from same session
    const r2 = await session.send('What is my secret code? Reply with just the number.')
    console.log(`  Turn 2: "${r2.text.slice(0, 80)}"`)
    assert(r2.text.includes('42'), 'Model remembers the secret code in same session')

    const historyLen = session.history.length
    assert(historyLen >= 4, `History has ${historyLen} messages (>= 4 expected)`)

    // Verify JSONL file has grown
    const rawAfter = readFileSync(jsonlPath, 'utf-8')
    const lines = rawAfter.split('\n').filter(l => l.trim())
    assert(lines.length >= 5, `JSONL has ${lines.length} entries (>= 5 expected)`)
  }

  // ════════════════════════════════════════════════════════════════════════
  // Step 2: Resume session — verify history is loaded from JSONL
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== Step 2: Resume session — verify history loaded from JSONL ===')
  {
    const agent = makeAgent()
    const resumed = agent.session(savedSessionId)

    assert(resumed.id === savedSessionId, 'Resumed session has same ID')

    const resumedHistoryLen = resumed.history.length
    assert(resumedHistoryLen >= 4, `Resumed history has ${resumedHistoryLen} messages (>= 4)`)

    // The model should have full context from the previous session
    const r3 = await resumed.send('What was my secret code? Reply with just the number.')
    console.log(`  Turn 3: "${r3.text.slice(0, 80)}"`)
    assert(r3.text.includes('42'), 'Model remembers secret code after resume')

    const finalHistoryLen = resumed.history.length
    assert(finalHistoryLen > resumedHistoryLen, `History grew: ${resumedHistoryLen} -> ${finalHistoryLen}`)
  }

  // ════════════════════════════════════════════════════════════════════════
  // Step 3: Verify loadSession API returns correct data
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== Step 3: Verify loadSession() API ===')
  {
    const loaded = loadSession(savedSessionId, { storageDir })
    assert(loaded !== null, 'loadSession returns data')
    assert(loaded!.metadata.sessionId === savedSessionId, 'Metadata sessionId matches')
    assert(loaded!.metadata.model.includes('claude'), 'Metadata model matches')
    assert(loaded!.messages.length >= 6, `Loaded ${loaded!.messages.length} messages (>= 6)`)
  }

  // ════════════════════════════════════════════════════════════════════════
  // Step 4: Verify listSessions API
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== Step 4: Verify listSessions() API ===')
  {
    const sessions = listSessions({ storageDir })
    assert(sessions.length >= 1, 'At least 1 session listed')
    const found = sessions.find(s => s.sessionId === savedSessionId)
    assert(found !== undefined, 'Our session appears in the list')
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────
  rmSync(storageDir, { recursive: true, force: true })
  console.log('\n=== All checks passed! ===\n')
}

main().catch(err => {
  console.error('E2E test failed:', err)
  rmSync(storageDir, { recursive: true, force: true })
  process.exit(1)
})
