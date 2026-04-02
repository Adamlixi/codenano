/**
 * Unit tests for memory extractor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMemoryExtractor } from '../src/memory/extractor.js'
import type { ExtractorConfig } from '../src/memory/extractor.js'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanMemories } from '../src/memory/storage.js'

// ─── Mock Anthropic Client ─────────────────────────────────────────────────

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  } as any
}

function makeConfig(overrides: Partial<ExtractorConfig> & { memoryDir: string }): ExtractorConfig {
  return {
    client: mockClient('[]'),
    model: 'claude-sonnet-4-6',
    extractStrategy: 'auto',
    ...overrides,
  }
}

const sampleMessages = [
  { role: 'user' as const, content: 'I am a data scientist working on ML pipelines' },
  { role: 'assistant' as const, content: 'Got it, I will help with your ML pipeline work.' },
]

describe('createMemoryExtractor', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'extractor-test-'))
  })

  // ── shouldExtract logic ──────────────────────────────────────────

  describe('shouldExtract', () => {
    it('does not extract when strategy is disabled', () => {
      const client = mockClient('[]')
      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'disabled',
      })

      extractor.triggerExtraction(sampleMessages)
      expect(client.messages.create).not.toHaveBeenCalled()
    })

    it('extracts every turn when strategy is auto', async () => {
      const client = mockClient('[]')
      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()
      expect(client.messages.create).toHaveBeenCalledTimes(1)
    })

    it('extracts on interval', async () => {
      const client = mockClient('[]')
      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: { interval: 3 },
      })

      // Turns 1, 2 — no extraction
      extractor.triggerExtraction(sampleMessages)
      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()
      expect(client.messages.create).toHaveBeenCalledTimes(0)

      // Turn 3 — triggers extraction
      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()
      expect(client.messages.create).toHaveBeenCalledTimes(1)
    })
  })

  // ── Memory saving ────────────────────────────────────────────────

  describe('runExtraction (direct API)', () => {
    it('saves extracted memories to disk', async () => {
      const responseJson = JSON.stringify([
        {
          name: 'user_role',
          description: 'User is a data scientist',
          type: 'user',
          content: 'Works on ML pipelines',
        },
      ])
      const client = mockClient('```json\n' + responseJson + '\n```')

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()

      const memories = scanMemories(tempDir)
      expect(memories).toHaveLength(1)
      expect(memories[0]!.name).toBe('user_role')
      expect(memories[0]!.type).toBe('user')
    })

    it('handles JSON array without code fence', async () => {
      const responseJson = JSON.stringify([
        { name: 'proj_info', description: 'Project deadline', type: 'project', content: 'Due Friday' },
      ])
      const client = mockClient(responseJson)

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()

      const memories = scanMemories(tempDir)
      expect(memories).toHaveLength(1)
      expect(memories[0]!.name).toBe('proj_info')
    })

    it('skips memories with missing fields', async () => {
      const responseJson = JSON.stringify([
        { name: 'good', description: 'Valid', type: 'user', content: 'Content' },
        { name: 'bad', description: 'Missing content', type: 'user' },  // no content
        { description: 'Missing name', type: 'user', content: 'Content' },  // no name
      ])
      const client = mockClient('```json\n' + responseJson + '\n```')

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()

      const memories = scanMemories(tempDir)
      expect(memories).toHaveLength(1)
      expect(memories[0]!.name).toBe('good')
    })

    it('handles empty response gracefully', async () => {
      const client = mockClient('')

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()

      const memories = scanMemories(tempDir)
      expect(memories).toHaveLength(0)
    })

    it('handles empty array response', async () => {
      const client = mockClient('```json\n[]\n```')

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()

      const memories = scanMemories(tempDir)
      expect(memories).toHaveLength(0)
    })

    it('handles API error gracefully (best-effort)', async () => {
      const client = {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('API error')),
        },
      } as any

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      // Should not throw
      extractor.triggerExtraction(sampleMessages)
      await extractor.drain()

      const memories = scanMemories(tempDir)
      expect(memories).toHaveLength(0)
    })
  })

  // ── Coalescing / trailing run ────────────────────────────────────

  describe('coalescing', () => {
    it('coalesces concurrent triggers into a trailing run', async () => {
      let resolveFirst: () => void
      const firstCallPromise = new Promise<void>(r => { resolveFirst = r })

      const client = {
        messages: {
          create: vi.fn()
            .mockImplementationOnce(() => firstCallPromise.then(() => ({
              content: [{ type: 'text', text: '[]' }],
            })))
            .mockResolvedValue({
              content: [{ type: 'text', text: '[]' }],
            }),
        },
      } as any

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      // First trigger starts extraction
      extractor.triggerExtraction(sampleMessages)
      // Second trigger while first is in progress — should coalesce
      extractor.triggerExtraction([...sampleMessages, { role: 'user', content: 'extra' }])

      // Release first extraction
      resolveFirst!()
      await extractor.drain()

      // Should have been called twice: initial + trailing
      expect(client.messages.create).toHaveBeenCalledTimes(2)
    })
  })

  // ── drain ────────────────────────────────────────────────────────

  describe('drain', () => {
    it('resolves immediately when no extraction in progress', async () => {
      const extractor = createMemoryExtractor({
        client: mockClient('[]'),
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      // Should resolve without hanging
      await extractor.drain()
    })

    it('waits for in-flight extraction', async () => {
      let resolveExtraction: () => void
      const extractionPromise = new Promise<void>(r => { resolveExtraction = r })

      const client = {
        messages: {
          create: vi.fn().mockImplementation(() =>
            extractionPromise.then(() => ({
              content: [{ type: 'text', text: '[]' }],
            }))
          ),
        },
      } as any

      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction(sampleMessages)

      // drain should wait
      let drained = false
      const drainPromise = extractor.drain().then(() => { drained = true })

      // Not drained yet
      await new Promise(r => setTimeout(r, 10))
      expect(drained).toBe(false)

      // Release extraction
      resolveExtraction!()
      await drainPromise
      expect(drained).toBe(true)
    })
  })

  // ── Message content handling ─────────────────────────────────────

  describe('message content formats', () => {
    it('handles string content messages', async () => {
      const client = mockClient('[]')
      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction([
        { role: 'user', content: 'plain string' },
      ])
      await extractor.drain()

      const callArgs = client.messages.create.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('plain string')
    })

    it('handles array content messages (extracts text blocks)', async () => {
      const client = mockClient('[]')
      const extractor = createMemoryExtractor({
        client,
        model: 'test',
        memoryDir: tempDir,
        extractStrategy: 'auto',
      })

      extractor.triggerExtraction([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'tool_use', id: 't1', name: 'Foo', input: {} },
            { type: 'text', text: ' world' },
          ],
        },
      ])
      await extractor.drain()

      const callArgs = client.messages.create.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('Hello')
      expect(callArgs.messages[0].content).toContain('world')
    })
  })
})
