/**
 * Unit tests for forked memory extractor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runForkedExtraction } from '../src/memory/forked-extractor.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanMemories, saveMemory } from '../src/memory/storage.js'

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  } as any
}

const sampleMessages = [
  { role: 'user' as const, content: 'My favorite language is Rust' },
  { role: 'assistant' as const, content: 'Noted, you prefer Rust.' },
]

describe('runForkedExtraction', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'forked-extractor-test-'))
  })

  it('saves extracted memories', async () => {
    const responseJson = JSON.stringify([
      { name: 'user_lang', description: 'Prefers Rust', type: 'user', content: 'Favorite language is Rust' },
    ])
    const client = mockClient('```json\n' + responseJson + '\n```')

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const memories = scanMemories(tempDir)
    expect(memories).toHaveLength(1)
    expect(memories[0]!.name).toBe('user_lang')
  })

  it('uses cache_control in system prompt', async () => {
    const client = mockClient('[]')

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const callArgs = client.messages.create.mock.calls[0][0]
    // System should be an array of blocks with cache_control
    expect(Array.isArray(callArgs.system)).toBe(true)
    expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('includes existing memories in context', async () => {
    // Pre-populate a memory
    saveMemory(
      { name: 'existing', description: 'Already saved', type: 'project', content: 'Some info' },
      tempDir,
    )

    const client = mockClient('[]')

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const callArgs = client.messages.create.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('existing')
  })

  it('handles JSON array without code fence', async () => {
    const responseJson = JSON.stringify([
      { name: 'ref_info', description: 'Ref', type: 'reference', content: 'Link' },
    ])
    const client = mockClient(responseJson)

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const memories = scanMemories(tempDir)
    expect(memories).toHaveLength(1)
  })

  it('skips memories with missing fields', async () => {
    const responseJson = JSON.stringify([
      { name: 'good', description: 'Valid', type: 'user', content: 'OK' },
      { name: 'bad' },  // missing fields
    ])
    const client = mockClient('```json\n' + responseJson + '\n```')

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const memories = scanMemories(tempDir)
    expect(memories).toHaveLength(1)
  })

  it('handles empty response', async () => {
    const client = mockClient('')

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const memories = scanMemories(tempDir)
    expect(memories).toHaveLength(0)
  })

  it('handles empty array', async () => {
    const client = mockClient('```json\n[]\n```')

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const memories = scanMemories(tempDir)
    expect(memories).toHaveLength(0)
  })

  it('handles API error gracefully', async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    } as any

    // Should not throw
    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      sampleMessages,
    )

    const memories = scanMemories(tempDir)
    expect(memories).toHaveLength(0)
  })

  it('handles array content messages', async () => {
    const client = mockClient('[]')

    await runForkedExtraction(
      { client, model: 'test', memoryDir: tempDir },
      [
        {
          role: 'assistant' as const,
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'tool_use', id: 't1', name: 'X', input: {} },
          ],
        },
      ],
    )

    const callArgs = client.messages.create.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('Hello')
  })
})
