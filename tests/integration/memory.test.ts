/**
 * Integration tests for memory system
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createAgent, saveMemory, scanMemories } from '../../src/index.js'
import { rmSync, existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('Memory System', () => {
  const testMemoryDir = mkdtempSync(join(tmpdir(), 'agent-memory-test-'))

  afterEach(() => {
    if (existsSync(testMemoryDir)) {
      rmSync(testMemoryDir, { recursive: true, force: true })
    }
  })

  it('should save and load memories', () => {
    saveMemory({
      name: 'test_memory',
      description: 'Test memory description',
      type: 'user',
      content: 'Test content',
    }, testMemoryDir)

    const memories = scanMemories(testMemoryDir)
    expect(memories).toHaveLength(1)
    expect(memories[0].name).toBe('test_memory')
    expect(memories[0].type).toBe('user')
  })

  it('should load memories into agent prompt', async () => {
    saveMemory({
      name: 'user_pref',
      description: 'User prefers brief responses',
      type: 'user',
      content: 'Keep responses concise',
    }, testMemoryDir)

    const agent = createAgent({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      ...(process.env.ANTHROPIC_API_KEY && { apiKey: process.env.ANTHROPIC_API_KEY }),
      memory: { autoLoad: true, memoryDir: testMemoryDir },
    })

    const result = await agent.ask('Say hello')
    expect(result.text).toBeTruthy()
  })
})
