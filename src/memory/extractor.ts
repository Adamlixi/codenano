/**
 * Memory extraction engine
 *
 * Inspired by Claude Code's extractMemories system:
 * - Fire-and-forget extraction after agent turns
 * - Mutex to prevent overlapping runs
 * - Trailing run for coalesced calls
 * - Uses a separate agent call to analyze conversation and extract memories
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { ExtractStrategy, Memory } from './types.js'
import { getMemoryDir, scanMemories, saveMemory, loadMemoryIndex } from './storage.js'
import { runForkedExtraction } from './forked-extractor.js'

const DEFAULT_EXTRACT_MAX_TURNS = 3

// ─── Extraction Prompt ─────────────────────────────────────────────────────

function buildExtractionPrompt(newMessageCount: number, existingMemories: Memory[], indexContent: string | null): string {
  const memList = existingMemories.length > 0
    ? existingMemories.map(m => `- [${m.type}] ${m.name}: ${m.description}`).join('\n')
    : '(none)'

  return `You are a memory extraction agent. Analyze the last ~${newMessageCount} messages in the conversation and decide if any information should be saved as persistent memories.

## Existing memories
${memList}

${indexContent ? `## Memory index (MEMORY.md)\n${indexContent}\n` : ''}

## Memory types
- **user**: User's role, preferences, knowledge
- **feedback**: Guidance on approach (what to avoid/repeat)
- **project**: Project state, goals, events (not derivable from code)
- **reference**: Pointers to external systems

## What NOT to save
- Code patterns, architecture, file paths (derivable from code)
- Git history
- Debugging solutions (fix is in the code)
- Ephemeral task details

## Output format
Respond with a JSON array of memories to save. If nothing worth saving, respond with [].

\`\`\`json
[
  {
    "name": "memory_file_name",
    "description": "one-line description",
    "type": "user|feedback|project|reference",
    "content": "memory content"
  }
]
\`\`\`

Only extract genuinely useful information that will help in future conversations. Be selective — quality over quantity.`
}

// ─── Extractor ─────────────────────────────────────────────────────────────

export interface ExtractorConfig {
  client: Anthropic
  model: string
  memoryDir?: string
  extractStrategy: ExtractStrategy
  extractMaxTurns?: number
  useForkedAgent?: boolean  // Use forked agent with caching (default: false for simplicity)
}

export interface ExtractorState {
  turnsSinceLastExtraction: number
  inProgress: boolean
  pendingMessages: MessageParam[] | null
}

/**
 * Create a memory extractor (closure-based, like Claude Code).
 * Returns functions for triggering and draining extractions.
 */
export function createMemoryExtractor(config: ExtractorConfig) {
  const {
    client,
    model,
    memoryDir,
    extractStrategy,
    extractMaxTurns = DEFAULT_EXTRACT_MAX_TURNS,
    useForkedAgent = false,
  } = config

  // ── Closure state ───────────────────────────────────────────────
  let inProgress = false
  let turnsSinceLastExtraction = 0
  let pendingMessages: MessageParam[] | null = null
  let currentExtraction: Promise<void> | null = null

  // ── Should extract this turn? ───────────────────────────────────
  function shouldExtract(): boolean {
    if (extractStrategy === 'disabled') return false

    if (extractStrategy === 'auto') return true

    if (typeof extractStrategy === 'object' && 'interval' in extractStrategy) {
      turnsSinceLastExtraction++
      if (turnsSinceLastExtraction >= extractStrategy.interval) {
        turnsSinceLastExtraction = 0
        return true
      }
      return false
    }

    return false
  }

  // ── Run extraction ──────────────────────────────────────────────
  async function runExtraction(messages: MessageParam[]): Promise<void> {
    if (useForkedAgent) {
      // Use forked agent with prompt caching
      await runForkedExtraction(
        { client, model, memoryDir, extractMaxTurns },
        messages
      )
    } else {
      // Use direct API call (simpler, but no caching)
      try {
        const dir = getMemoryDir(memoryDir)
        const existingMemories = scanMemories(memoryDir)
        const indexContent = loadMemoryIndex(memoryDir)

        const prompt = buildExtractionPrompt(
          Math.min(messages.length, 10),
          existingMemories,
          indexContent,
        )

        // Call model to extract memories
        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          system: prompt,
          messages: messages.slice(-10), // Last 10 messages for context
        })

        // Parse response
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')

        const jsonMatch = text.match(/\[[\s\S]*\]/)
        if (!jsonMatch) return

        const memories: Memory[] = JSON.parse(jsonMatch[0])
        if (!Array.isArray(memories) || memories.length === 0) return

        // Save extracted memories
        for (const mem of memories) {
          if (mem.name && mem.description && mem.type && mem.content) {
            saveMemory(mem, memoryDir)
          }
        }
      } catch {
        // Extraction is best-effort — log but don't throw
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Trigger extraction (fire-and-forget).
   * If already running, coalesces the call for a trailing run.
   */
  function triggerExtraction(messages: MessageParam[]): void {
    if (!shouldExtract()) return

    if (inProgress) {
      // Coalesce: store latest messages for trailing run
      pendingMessages = [...messages]
      return
    }

    inProgress = true
    currentExtraction = (async () => {
      try {
        await runExtraction(messages)
      } finally {
        inProgress = false
        // Handle trailing run
        const trailing = pendingMessages
        pendingMessages = null
        if (trailing) {
          inProgress = true
          try {
            await runExtraction(trailing)
          } finally {
            inProgress = false
            currentExtraction = null
          }
          return
        }
        currentExtraction = null
      }
    })()
  }

  /**
   * Wait for any in-flight extraction to complete.
   * Call this before process exit to avoid losing work.
   */
  async function drain(timeoutMs = 30_000): Promise<void> {
    if (!currentExtraction) return
    await Promise.race([
      currentExtraction.catch(() => {}),
      new Promise<void>(r => setTimeout(r, timeoutMs)),
    ])
  }

  return { triggerExtraction, drain }
}
