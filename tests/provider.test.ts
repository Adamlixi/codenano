/**
 * provider.ts — Tests for helper functions (no real API calls)
 *
 * Tests: toolDefsToAPISchemas, buildToolResultMessage, mergeConsecutiveUserMessages
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool } from '../src/tool-builder.js'
import {
  toolDefsToAPISchemas,
  buildToolResultMessage,
  mergeConsecutiveUserMessages,
} from '../src/provider.js'

// ─── toolDefsToAPISchemas ──────────────────────────────────────────────────

describe('toolDefsToAPISchemas', () => {
  it('converts a single tool to API schema', () => {
    const tool = defineTool({
      name: 'ReadFile',
      description: 'Read a file from disk',
      input: z.object({ path: z.string() }),
      execute: async () => 'content',
    })

    const schemas = toolDefsToAPISchemas([tool])

    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.name).toBe('ReadFile')
    expect(schemas[0]!.description).toBe('Read a file from disk')
    expect(schemas[0]!.input_schema).toBeDefined()
    expect((schemas[0]!.input_schema as any).properties.path).toBeDefined()
  })

  it('converts multiple tools', () => {
    const tools = [
      defineTool({
        name: 'Read',
        description: 'Read',
        input: z.object({ path: z.string() }),
        execute: async () => '',
      }),
      defineTool({
        name: 'Write',
        description: 'Write',
        input: z.object({ path: z.string(), content: z.string() }),
        execute: async () => '',
      }),
    ]

    const schemas = toolDefsToAPISchemas(tools)

    expect(schemas).toHaveLength(2)
    expect(schemas[0]!.name).toBe('Read')
    expect(schemas[1]!.name).toBe('Write')
    expect((schemas[1]!.input_schema as any).properties.content).toBeDefined()
  })

  it('returns empty array for no tools', () => {
    expect(toolDefsToAPISchemas([])).toEqual([])
  })

  it('handles complex Zod schemas', () => {
    const tool = defineTool({
      name: 'Search',
      description: 'Search files',
      input: z.object({
        query: z.string().describe('Search query'),
        maxResults: z.number().optional().default(10),
        caseSensitive: z.boolean().optional(),
      }),
      execute: async () => '[]',
    })

    const schemas = toolDefsToAPISchemas([tool])
    const props = (schemas[0]!.input_schema as any).properties

    expect(props.query).toBeDefined()
    expect(props.maxResults).toBeDefined()
    expect(props.caseSensitive).toBeDefined()
  })

  it('handles nested object schemas', () => {
    const tool = defineTool({
      name: 'Config',
      description: 'Set config',
      input: z.object({
        settings: z.object({
          theme: z.string(),
          fontSize: z.number(),
        }),
      }),
      execute: async () => 'ok',
    })

    const schemas = toolDefsToAPISchemas([tool])
    const settingsProps = (schemas[0]!.input_schema as any).properties.settings.properties

    expect(settingsProps.theme).toBeDefined()
    expect(settingsProps.fontSize).toBeDefined()
  })

  it('handles enum schemas', () => {
    const tool = defineTool({
      name: 'SetMode',
      description: 'Set mode',
      input: z.object({
        mode: z.enum(['fast', 'slow', 'auto']),
      }),
      execute: async () => 'ok',
    })

    const schemas = toolDefsToAPISchemas([tool])
    const modeSchema = (schemas[0]!.input_schema as any).properties.mode

    expect(modeSchema.enum).toEqual(['fast', 'slow', 'auto'])
  })
})

// ─── buildToolResultMessage ────────────────────────────────────────────────

describe('buildToolResultMessage', () => {
  it('builds a success tool result', () => {
    const msg = buildToolResultMessage('tu_123', 'file content here', false)

    expect(msg.role).toBe('user')
    expect(msg.content).toHaveLength(1)
    expect(msg.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu_123',
      content: 'file content here',
      is_error: false,
    })
  })

  it('builds an error tool result', () => {
    const msg = buildToolResultMessage('tu_456', 'File not found', true)

    expect(msg.role).toBe('user')
    expect(msg.content[0].is_error).toBe(true)
    expect(msg.content[0].content).toBe('File not found')
  })

  it('preserves tool_use_id exactly', () => {
    const msg = buildToolResultMessage('toolu_abc-XYZ_123', 'ok', false)
    expect(msg.content[0].tool_use_id).toBe('toolu_abc-XYZ_123')
  })

  it('handles empty output', () => {
    const msg = buildToolResultMessage('tu_1', '', false)
    expect(msg.content[0].content).toBe('')
  })

  it('handles very long output', () => {
    const longOutput = 'x'.repeat(100_000)
    const msg = buildToolResultMessage('tu_1', longOutput, false)
    expect(msg.content[0].content).toHaveLength(100_000)
  })
})

// ─── mergeConsecutiveUserMessages ──────────────────────────────────────────

describe('mergeConsecutiveUserMessages', () => {
  it('returns empty array for empty input', () => {
    expect(mergeConsecutiveUserMessages([])).toEqual([])
  })

  it('passes through non-consecutive messages unchanged', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'bye' },
    ]

    const result = mergeConsecutiveUserMessages(messages)
    expect(result).toHaveLength(3)
    expect(result[0]!.content).toBe('hello')
    expect(result[1]!.content).toBe('hi')
    expect(result[2]!.content).toBe('bye')
  })

  it('merges two consecutive user messages with string content', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ]

    const result = mergeConsecutiveUserMessages(messages)

    expect(result).toHaveLength(1)
    expect(result[0]!.role).toBe('user')
    expect(Array.isArray(result[0]!.content)).toBe(true)
    expect(result[0]!.content).toHaveLength(2)
    expect(result[0]!.content[0]).toEqual({ type: 'text', text: 'first' })
    expect(result[0]!.content[1]).toEqual({ type: 'text', text: 'second' })
  })

  it('merges consecutive user messages with array content', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'msg1' }] },
      { role: 'user', content: [{ type: 'text', text: 'msg2' }] },
    ]

    const result = mergeConsecutiveUserMessages(messages)

    expect(result).toHaveLength(1)
    expect(result[0]!.content).toHaveLength(2)
  })

  it('merges three consecutive user messages', () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
    ]

    const result = mergeConsecutiveUserMessages(messages)

    expect(result).toHaveLength(1)
    expect(result[0]!.content).toHaveLength(3)
  })

  it('handles mixed: merge-skip-merge pattern', () => {
    const messages = [
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u3' },
      { role: 'user', content: 'u4' },
    ]

    const result = mergeConsecutiveUserMessages(messages)

    expect(result).toHaveLength(3)
    expect(result[0]!.role).toBe('user')
    expect(result[0]!.content).toHaveLength(2) // u1 + u2
    expect(result[1]!.role).toBe('assistant')
    expect(result[2]!.role).toBe('user')
    expect(result[2]!.content).toHaveLength(2) // u3 + u4
  })

  it('does not merge consecutive assistant messages', () => {
    const messages = [
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
    ]

    const result = mergeConsecutiveUserMessages(messages)
    expect(result).toHaveLength(2)
  })

  it('handles single message', () => {
    const messages = [{ role: 'user', content: 'only one' }]
    const result = mergeConsecutiveUserMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe('only one')
  })

  it('merges tool_result content blocks', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'result1' }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'result2' }],
      },
    ]

    const result = mergeConsecutiveUserMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toHaveLength(2)
    expect(result[0]!.content[0].tool_use_id).toBe('tu_1')
    expect(result[0]!.content[1].tool_use_id).toBe('tu_2')
  })
})
