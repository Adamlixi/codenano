/**
 * compact.ts — Auto-compact and token management
 *
 * Ports the auto-compaction logic from codenano's:
 *   - src/services/compact/autoCompact.ts  (thresholds, shouldAutoCompact)
 *   - src/services/compact/prompt.ts       (compact prompt, summary formatting)
 *   - src/utils/tokens.ts                  (tokenCountWithEstimation)
 *
 * Key constants from codenano:
 *   AUTOCOMPACT_BUFFER_TOKENS = 13_000
 *   getEffectiveContextWindowSize = contextWindow - min(maxOutputTokens, 20_000)
 *   getAutoCompactThreshold = effectiveWindow - 13_000
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { AgentConfig, Usage } from './types.js'
import { callModel } from './provider.js'

// ─── Constants ───────────────────────────────────────────────────────────────

const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const MAX_OUTPUT_TOKENS_RESERVE = 20_000

// All current Claude models have 200k context window
const DEFAULT_CONTEXT_WINDOW = 200_000

// ─── Token Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate token count for messages.
 *
 * Strategy:
 * 1. If lastUsage provided, use it as base (most accurate)
 * 2. Otherwise, estimate: chars / 3.5 (improved from /4)
 * 3. Add overhead for tool calls and structured content
 */
export function estimateTokens(messages: MessageParam[], lastUsage?: Usage): number {
  if (lastUsage) {
    return lastUsage.inputTokens + lastUsage.outputTokens
  }

  let totalChars = 0
  let toolCallCount = 0

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null) {
          const b = block as unknown as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') {
            totalChars += b.text.length
          } else if (b.type === 'tool_result' && typeof b.content === 'string') {
            totalChars += b.content.length
          } else if (b.type === 'tool_use' && b.input) {
            const jsonStr = JSON.stringify(b.input)
            totalChars += jsonStr.length
            toolCallCount++
          }
        }
      }
    }
  }

  // Base estimate: 3.5 chars per token (more accurate than 4)
  const baseTokens = Math.ceil(totalChars / 3.5)

  // Add overhead: ~50 tokens per tool call for structure
  const toolOverhead = toolCallCount * 50

  return baseTokens + toolOverhead
}

// ─── Threshold Calculation ───────────────────────────────────────────────────

function getContextWindow(_model: string): number {
  // All Claude models (haiku, sonnet, opus) currently have 200k context
  return DEFAULT_CONTEXT_WINDOW
}

function getEffectiveContextWindow(model: string, maxOutputTokens = 16384): number {
  return getContextWindow(model) - Math.min(maxOutputTokens, MAX_OUTPUT_TOKENS_RESERVE)
}

function getAutoCompactThreshold(model: string, maxOutputTokens?: number): number {
  return getEffectiveContextWindow(model, maxOutputTokens) - AUTOCOMPACT_BUFFER_TOKENS
}

/**
 * Returns true if the conversation should be auto-compacted before the next
 * model call.
 */
export function shouldAutoCompact(
  messages: MessageParam[],
  config: AgentConfig,
  lastUsage?: Usage,
): boolean {
  if (config.autoCompact === false) return false

  const estimated = estimateTokens(messages, lastUsage)
  const threshold = getAutoCompactThreshold(config.model, config.maxOutputTokens)

  return estimated >= threshold
}

// ─── Compact Prompt ──────────────────────────────────────────────────────────

/**
 * The compaction prompt — mirrors BASE_COMPACT_PROMPT from codenano.
 *
 * Asks the model to produce a structured summary of the conversation,
 * covering 9 sections that preserve enough context to resume work.
 */
const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and the work that has been done.

This summary will be used to compact the conversation context while preserving all essential information needed to continue the work effectively.

## Summary Structure

Please organize the summary with these sections:

### 1. Primary Request and Intent
What is the user trying to accomplish? What is the overall goal? Include any explicit instructions about how they want you to work.

### 2. Key Technical Concepts
List the important technical concepts, technologies, and domain knowledge discussed. Include specific versions, APIs, patterns, and terminology.

### 3. Files and Code
Document all files that have been created or modified. For each file include:
- File path
- What it does / purpose
- Key implementation details
- Any important patterns or decisions made

### 4. Errors and Debugging
Document any errors encountered and how they were resolved. Include error messages, root causes, and fixes applied.

### 5. Problem Solving Approach
Describe the reasoning and approaches used to solve problems. What worked, what didn't, and why.

### 6. User Instructions and Preferences
Capture explicit instructions about coding style, workflow, tools to use or avoid, and any other preferences the user has expressed.

### 7. Pending Tasks
List tasks that have been explicitly requested but not yet completed. Include any partial work in progress.

### 8. Current Work
Describe what was being worked on at the point of compaction. What was the last action taken?

### 9. Next Steps
What should happen next? What is the immediate next action to take?`

/**
 * Format the compact prompt for sending to the model.
 */
function getCompactPrompt(): string {
  return `${BASE_COMPACT_PROMPT}

Please provide your summary now. Wrap the entire summary in <summary> tags.`
}

/**
 * Extract the summary content from the model's response.
 * Strips any <analysis> preamble and extracts content from <summary> tags.
 */
function formatCompactSummary(text: string): string {
  // Remove <analysis>...</analysis> block if present
  const withoutAnalysis = text.replace(/<analysis>[\s\S]*?<\/analysis>/g, '').trim()

  // Extract <summary>...</summary> content
  const summaryMatch = withoutAnalysis.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim()
  }

  // Fallback: return the whole response if no summary tags found
  return withoutAnalysis
}

/**
 * Build the "session continuation" user message injected after compaction.
 * Mirrors getCompactUserSummaryMessage() in codenano.
 */
function buildContinuationMessage(summary: string): string {
  return `This session is being continued from a previous conversation that was compacted to save context space. The summary below covers the earlier portion of the conversation.

Summary:
${summary}

Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`
}

// ─── compactMessages ─────────────────────────────────────────────────────────

/**
 * Compact the conversation by asking the model to summarize it,
 * then return a fresh message array starting with the summary.
 *
 * Returns the compacted message array on success, or null on failure.
 */
export async function compactMessages(
  messages: MessageParam[],
  systemPrompt: string,
  client: Anthropic,
  config: AgentConfig,
  signal: AbortSignal,
): Promise<MessageParam[] | null> {
  try {
    // Build messages for the compaction call:
    // all existing messages + a user request to summarize
    const compactionMessages: MessageParam[] = [
      ...messages,
      {
        role: 'user' as const,
        content: getCompactPrompt(),
      },
    ]

    const result = await callModel(
      client,
      compactionMessages,
      systemPrompt,
      [], // No tools for compaction
      {
        ...config,
        maxOutputTokens: 8192, // Summary doesn't need huge output
      },
      signal,
    )

    const summaryText = result.assistantContent
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    if (!summaryText) return null

    const summary = formatCompactSummary(summaryText)
    const continuationMessage = buildContinuationMessage(summary)

    // Return a fresh message array: just the continuation message
    // The system prompt is preserved separately (passed to each API call)
    return [
      {
        role: 'user' as const,
        content: continuationMessage,
      },
    ]
  } catch (error) {
    // Compaction failed — return null and let caller handle
    const msg = error instanceof Error ? error.message : String(error)
    if (process.env.NODE_ENV !== 'test') {
      console.error('[agent-core] Auto-compact failed:', msg)
    }
    return null
  }
}

// ─── 413 Detection ───────────────────────────────────────────────────────────

/**
 * Returns true if the error is a "prompt too long" / context overflow error.
 * Covers Anthropic 413, Bedrock equivalent messages, and SDK error strings.
 */
export function isPromptTooLongError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('prompt is too long') || msg.includes('prompt too long')) return true
    if (msg.includes('context window') && msg.includes('exceed')) return true
    if (msg.includes('413')) return true
    if (msg.includes('request too large')) return true
  }
  // Check HTTP status if available (Anthropic SDK APIStatusError)
  const e = error as any
  if (e?.status === 413) return true
  return false
}
