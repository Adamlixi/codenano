/**
 * compact-advanced.test.ts — Test auto-compact edge cases
 */

import { describe, it, expect, vi } from 'vitest'
import { shouldAutoCompact, compactMessages } from '../src/compact.js'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { AgentConfig, Usage } from '../src/types.js'

describe('Auto-compact edge cases', () => {
  it('should not compact when disabled', () => {
    const messages: MessageParam[] = [
      { role: 'user', content: 'test' },
      { role: 'assistant', content: 'response' },
    ]
    const config: AgentConfig = { model: 'test', apiKey: 'test', autoCompact: false }
    const usage: Usage = { inputTokens: 150000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }

    const result = shouldAutoCompact(messages, config, usage)
    expect(result).toBe(false)
  })

  it('should compact when threshold exceeded', () => {
    const messages: MessageParam[] = [
      { role: 'user', content: 'test' },
      { role: 'assistant', content: 'response' },
      { role: 'user', content: 'more' },
      { role: 'assistant', content: 'more response' },
    ]
    const config: AgentConfig = { model: 'claude-sonnet-4-6', apiKey: 'test' }
    // Threshold = 200k - min(16384, 20k) - 13k = 200k - 16384 - 13k = ~170.6k
    // Need total tokens (input + output) > 170.6k
    const usage: Usage = { inputTokens: 170000, outputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }

    const result = shouldAutoCompact(messages, config, usage)
    expect(result).toBe(true)
  })

  it('should not compact with few messages', () => {
    const messages: MessageParam[] = [
      { role: 'user', content: 'test' },
    ]
    const config: AgentConfig = { model: 'test', apiKey: 'test' }
    const usage: Usage = { inputTokens: 150000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }

    const result = shouldAutoCompact(messages, config, usage)
    expect(result).toBe(false)
  })
})
