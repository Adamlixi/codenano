/**
 * snip-compact.ts — Lightweight history trimming
 *
 * Removes old messages to prevent context overflow.
 * No LLM calls, instant execution, zero cost.
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'

// Configuration
const SNIP_THRESHOLD = 50 // Start snipping after 50 messages
const KEEP_HEAD = 2 // Keep first 2 messages (initial context)
const KEEP_TAIL = 20 // Keep last 20 messages (recent context)

/**
 * Snip old messages if conversation is too long.
 * Returns { messages, snipped: boolean }
 */
export function snipIfNeeded(messages: MessageParam[]): {
  messages: MessageParam[]
  snipped: boolean
} {
  if (messages.length <= SNIP_THRESHOLD) {
    return { messages, snipped: false }
  }

  // Keep head (initial context) + tail (recent context)
  const head = messages.slice(0, KEEP_HEAD)
  const tail = messages.slice(-KEEP_TAIL)

  return {
    messages: [...head, ...tail],
    snipped: true,
  }
}
