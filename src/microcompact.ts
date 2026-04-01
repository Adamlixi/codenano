/**
 * microcompact.ts — Tool result compression
 *
 * Compresses large tool results to save tokens.
 * Keeps first N and last M chars, replaces middle with summary.
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'

// Configuration
const MAX_TOOL_RESULT_SIZE = 10_000 // 10K chars max per tool result
const KEEP_PREFIX = 2_000 // Keep first 2K chars
const KEEP_SUFFIX = 2_000 // Keep last 2K chars

type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

/**
 * Compress tool results in messages if they exceed size limit.
 */
export function microcompact(messages: MessageParam[]): {
  messages: MessageParam[]
  compressed: number
} {
  let compressed = 0

  const result = messages.map(msg => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) {
      return msg
    }

    const newContent = msg.content.map(block => {
      if (typeof block !== 'object' || block.type !== 'tool_result') {
        return block
      }

      const toolBlock = block as ToolResultBlock
      if (typeof toolBlock.content !== 'string') {
        return block
      }

      if (toolBlock.content.length <= MAX_TOOL_RESULT_SIZE) {
        return block
      }

      // Compress: keep prefix + suffix, replace middle
      const prefix = toolBlock.content.slice(0, KEEP_PREFIX)
      const suffix = toolBlock.content.slice(-KEEP_SUFFIX)
      const omitted = toolBlock.content.length - KEEP_PREFIX - KEEP_SUFFIX

      compressed++

      return {
        ...toolBlock,
        content: `${prefix}\n\n[... ${omitted.toLocaleString()} chars omitted ...]\n\n${suffix}`,
      }
    })

    return { ...msg, content: newContent }
  })

  return { messages: result, compressed }
}
