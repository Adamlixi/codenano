import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool } from '../src/tool-builder.js'

describe('defineTool', () => {
  it('creates a tool with all required fields', () => {
    const tool = defineTool({
      name: 'TestTool',
      description: 'A test tool',
      input: z.object({ value: z.string() }),
      execute: async ({ value }) => `echo: ${value}`,
    })

    expect(tool.name).toBe('TestTool')
    expect(tool.description).toBe('A test tool')
    expect(tool.isReadOnly).toBe(false)
    expect(tool.isConcurrencySafe).toBe(false)
  })

  it('defaults isConcurrencySafe to isReadOnly', () => {
    const tool = defineTool({
      name: 'ReadOnly',
      description: 'A read-only tool',
      input: z.object({}),
      execute: async () => 'ok',
      isReadOnly: true,
    })

    expect(tool.isReadOnly).toBe(true)
    expect(tool.isConcurrencySafe).toBe(true)
  })

  it('allows overriding isConcurrencySafe independently', () => {
    const tool = defineTool({
      name: 'Mixed',
      description: 'Read-only but not concurrent',
      input: z.object({}),
      execute: async () => 'ok',
      isReadOnly: true,
      isConcurrencySafe: false,
    })

    expect(tool.isReadOnly).toBe(true)
    expect(tool.isConcurrencySafe).toBe(false)
  })

  it('validates input via Zod schema', () => {
    const tool = defineTool({
      name: 'Strict',
      description: 'Strict input',
      input: z.object({
        path: z.string().min(1),
        lines: z.number().int().positive(),
      }),
      execute: async () => 'ok',
    })

    // Valid input
    const valid = tool.input.safeParse({ path: '/tmp/test', lines: 10 })
    expect(valid.success).toBe(true)

    // Invalid input
    const invalid = tool.input.safeParse({ path: '', lines: -1 })
    expect(invalid.success).toBe(false)
  })

  it('executes with validated input', async () => {
    const tool = defineTool({
      name: 'Echo',
      description: 'Echo back',
      input: z.object({ message: z.string() }),
      execute: async ({ message }) => `Echoed: ${message}`,
    })

    const context = {
      signal: new AbortController().signal,
      messages: [],
    }
    const result = await tool.execute({ message: 'hello' }, context)
    expect(result).toBe('Echoed: hello')
  })

  it('supports function-based isReadOnly', () => {
    const tool = defineTool({
      name: 'Conditional',
      description: 'Conditionally read-only',
      input: z.object({ mode: z.enum(['read', 'write']) }),
      execute: async () => 'ok',
      isReadOnly: (input) => input.mode === 'read',
    })

    expect(typeof tool.isReadOnly).toBe('function')
    if (typeof tool.isReadOnly === 'function') {
      expect(tool.isReadOnly({ mode: 'read' })).toBe(true)
      expect(tool.isReadOnly({ mode: 'write' })).toBe(false)
    }
  })
})
