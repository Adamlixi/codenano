/**
 * events.ts — Tests for stream event transformation (toPublicEvent)
 */

import { describe, it, expect } from 'vitest'
import { toPublicEvent } from '../src/events.js'
import type { ModelStreamEvent } from '../src/provider.js'

describe('toPublicEvent', () => {
  it('converts text_delta to text event', () => {
    const event: ModelStreamEvent = { type: 'text_delta', text: 'hello world' }
    const result = toPublicEvent(event, 1)
    expect(result).toEqual({ type: 'text', text: 'hello world' })
  })

  it('converts thinking_delta to thinking event', () => {
    const event: ModelStreamEvent = { type: 'thinking_delta', thinking: 'reasoning...' }
    const result = toPublicEvent(event, 2)
    expect(result).toEqual({ type: 'thinking', thinking: 'reasoning...' })
  })

  it('converts tool_use_start to tool_use event', () => {
    const event: ModelStreamEvent = { type: 'tool_use_start', id: 'tu_123', name: 'ReadFile' }
    const result = toPublicEvent(event, 1)
    expect(result).toEqual({
      type: 'tool_use',
      toolName: 'ReadFile',
      toolUseId: 'tu_123',
      input: undefined,
    })
  })

  it('converts message_start to turn_start event', () => {
    const event: ModelStreamEvent = { type: 'message_start', messageId: 'msg_abc' }
    const result = toPublicEvent(event, 3)
    expect(result).toEqual({ type: 'turn_start', turnNumber: 3 })
  })

  it('converts message_delta with stopReason to turn_end event', () => {
    const event: ModelStreamEvent = {
      type: 'message_delta',
      stopReason: 'end_turn',
      usage: { inputTokens: 10 },
    }
    const result = toPublicEvent(event, 2)
    expect(result).toEqual({ type: 'turn_end', stopReason: 'end_turn', turnNumber: 2 })
  })

  it('returns null for message_delta without stopReason', () => {
    const event: ModelStreamEvent = {
      type: 'message_delta',
      stopReason: null,
      usage: { outputTokens: 5 },
    }
    const result = toPublicEvent(event, 1)
    expect(result).toBeNull()
  })

  it('returns null for input_json_delta', () => {
    const event: ModelStreamEvent = { type: 'input_json_delta', partialJson: '{"key":' }
    expect(toPublicEvent(event, 1)).toBeNull()
  })

  it('returns null for content_block_stop', () => {
    const event: ModelStreamEvent = { type: 'content_block_stop', index: 0 }
    expect(toPublicEvent(event, 1)).toBeNull()
  })

  it('returns null for message_complete', () => {
    const event: ModelStreamEvent = {
      type: 'message_complete',
      result: {
        message: {} as any,
        assistantContent: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      },
    }
    expect(toPublicEvent(event, 1)).toBeNull()
  })

  it('passes turnNumber correctly to all turn-related events', () => {
    const startEvent: ModelStreamEvent = { type: 'message_start', messageId: 'x' }
    const deltaEvent: ModelStreamEvent = {
      type: 'message_delta',
      stopReason: 'tool_use',
      usage: {},
    }

    expect(toPublicEvent(startEvent, 7)).toEqual({ type: 'turn_start', turnNumber: 7 })
    expect(toPublicEvent(deltaEvent, 7)).toEqual({ type: 'turn_end', stopReason: 'tool_use', turnNumber: 7 })
  })

  it('handles empty text_delta', () => {
    const event: ModelStreamEvent = { type: 'text_delta', text: '' }
    const result = toPublicEvent(event, 1)
    expect(result).toEqual({ type: 'text', text: '' })
  })
})
