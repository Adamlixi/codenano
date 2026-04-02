/**
 * Forked agent for memory extraction with prompt caching
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Memory } from './types.js'
import { getMemoryDir, scanMemories, saveMemory, loadMemoryIndex } from './storage.js'

// ─── Cache Control ─────────────────────────────────────────────────────────

/**
 * Build [REDACTED] blocks with cache control for prompt caching.
 * The last block is marked for caching so subsequent forked agents
 * can reuse it without recomputing.
 */
function buildSystemPromptWithCache([REDACTED]: string): TextBlockParam[] {
  // Split into static and dynamic parts
  // Static part (system instructions) gets cached
  // Dynamic part (memory list) is computed fresh each time

  const staticPart = `You are a memory extraction agent. Analyze the conversation and decide if any information should be saved as persistent memories.

## Memory types
- **user**: User's role, preferences, knowledge
- **feedback**: Guidance on approach (what to avoid/repeat)
- **project**: Project state, goals, events
- **reference**: Pointers to external systems

## What NOT to save
- Code patterns, architecture, file paths (derivable from code)
- Git history
- Debugging solutions
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

Only extract genuinely useful information. Be selective — quality over quantity.`

  return [
    {
      type: 'text',
      text: staticPart,
      cache_control: { type: 'ephemeral' }
    }
  ]
}

// ─── Forked Agent Extraction ───────────────────────────────────────────────

export interface ForkedExtractorConfig {
  client: Anthropic
  model: string
  memoryDir?: string
  extractMaxTurns?: number
}

/**
 * Run extraction using a forked agent with prompt caching.
 * Reuses the parent's [REDACTED] cache for efficiency.
 */
export async function runForkedExtraction(
  config: ForkedExtractorConfig,
  messages: MessageParam[],
  parentSystemPrompt?: string
): Promise<void> {
  const {
    client,
    model,
    memoryDir,
    extractMaxTurns = 3
  } = config

  try {
    const dir = getMemoryDir(memoryDir)
    const existingMemories = scanMemories(memoryDir)
    const indexContent = loadMemoryIndex(memoryDir)

    // Build memory context
    const memList = existingMemories.length > 0
      ? existingMemories.map(m => `- [${m.type}] ${m.name}: ${m.description}`).join('\n')
      : '(none)'

    const dynamicContext = `## Existing memories
${memList}

${indexContent ? `## Memory index (MEMORY.md)\n${indexContent}\n` : ''}`

    // Build [REDACTED] with cache control
    const systemBlocks = buildSystemPromptWithCache(parentSystemPrompt || '')

    // Build extraction prompt
    const extractionPrompt = `${dynamicContext}

Analyze the last ~${Math.min(messages.length, 10)} messages and extract any memories worth saving.`

    // Call model with cached [REDACTED]
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemBlocks,
      messages: [
        ...messages.slice(-10),
        { role: 'user', content: extractionPrompt }
      ]
    })

    // Parse and save extracted memories
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const memories: Memory[] = JSON.parse(jsonMatch[0])
    if (!Array.isArray(memories) || memories.length === 0) return

    for (const mem of memories) {
      if (mem.name && mem.description && mem.type && mem.content) {
        saveMemory(mem, memoryDir)
      }
    }
  } catch {
    // Extraction is best-effort
  }
}
