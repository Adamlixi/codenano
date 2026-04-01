/**
 * tool-executor-advanced.test.ts — Test tool executor edge cases
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { partitionToolCalls } from '../src/tool-executor.js'
import { defineTool } from '../src/index.js'
import type Anthropic from '@anthropic-ai/sdk'

describe('Tool executor partitioning', () => {
  it('partitions concurrent-safe tools together', () => {
    const tool1 = defineTool({
      name: 'read',
      description: 'test',
      input: z.object({}),
      execute: async () => 'ok',
      isConcurrencySafe: true,
    })

    const tool2 = defineTool({
      name: 'read2',
      description: 'test',
      input: z.object({}),
      execute: async () => 'ok',
      isConcurrencySafe: true,
    })

    const toolMap = new Map([
      ['read', tool1],
      ['read2', tool2],
    ])

    const blocks: Anthropic.ToolUseBlock[] = [
      { type: 'tool_use', id: '1', name: 'read', input: {} },
      { type: 'tool_use', id: '2', name: 'read2', input: {} },
    ]

    const batches = partitionToolCalls(blocks, toolMap)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.isConcurrencySafe).toBe(true)
    expect(batches[0]!.blocks).toHaveLength(2)
  })

  it('separates non-concurrent tools', () => {
    const tool1 = defineTool({
      name: 'write',
      description: 'test',
      input: z.object({}),
      execute: async () => 'ok',
      isConcurrencySafe: false,
    })

    const tool2 = defineTool({
      name: 'write2',
      description: 'test',
      input: z.object({}),
      execute: async () => 'ok',
      isConcurrencySafe: false,
    })

    const toolMap = new Map([
      ['write', tool1],
      ['write2', tool2],
    ])

    const blocks: Anthropic.ToolUseBlock[] = [
      { type: 'tool_use', id: '1', name: 'write', input: {} },
      { type: 'tool_use', id: '2', name: 'write2', input: {} },
    ]

    const batches = partitionToolCalls(blocks, toolMap)
    expect(batches).toHaveLength(2)
  })
})
