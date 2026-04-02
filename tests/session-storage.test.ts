import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendEntry,
  loadSession,
  listSessions,
  getSessionStorageDir,
  getSessionFilePath,
} from '../src/session-storage.js'
import type { TranscriptEntry, SessionMetadata } from '../src/session-storage.js'

describe('session-storage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-storage-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const config = () => ({ storageDir: tempDir })

  describe('getSessionStorageDir', () => {
    it('uses custom dir when provided', () => {
      const dir = getSessionStorageDir({ storageDir: tempDir })
      expect(dir).toBe(tempDir)
    })

    it('creates directory if it does not exist', () => {
      const nested = join(tempDir, 'nested', 'dir')
      const dir = getSessionStorageDir({ storageDir: nested })
      expect(dir).toBe(nested)
      expect(existsSync(nested)).toBe(true)
    })
  })

  describe('getSessionFilePath', () => {
    it('returns correct JSONL path', () => {
      const path = getSessionFilePath('abc-123', config())
      expect(path).toBe(join(tempDir, 'abc-123.jsonl'))
    })
  })

  describe('appendEntry + loadSession round-trip', () => {
    it('persists and restores metadata + messages', () => {
      const sessionId = 'test-session-1'
      const metadata: SessionMetadata = {
        sessionId,
        model: 'claude-sonnet-4-6',
        createdAt: '2025-01-01T00:00:00.000Z',
      }

      // Write metadata
      appendEntry(sessionId, {
        type: 'metadata',
        timestamp: metadata.createdAt,
        metadata,
      }, config())

      // Write messages
      appendEntry(sessionId, {
        type: 'message',
        timestamp: '2025-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'Hello' },
      }, config())

      appendEntry(sessionId, {
        type: 'message',
        timestamp: '2025-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: 'Hi there!' },
      }, config())

      // Load and verify
      const loaded = loadSession(sessionId, config())
      expect(loaded).not.toBeNull()
      expect(loaded!.metadata).toEqual(metadata)
      expect(loaded!.messages).toHaveLength(2)
      expect(loaded!.messages[0]).toEqual({ role: 'user', content: 'Hello' })
      expect(loaded!.messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' })
    })

    it('returns null for non-existent session', () => {
      const loaded = loadSession('does-not-exist', config())
      expect(loaded).toBeNull()
    })
  })

  describe('malformed line handling', () => {
    it('skips malformed lines gracefully', () => {
      const sessionId = 'malformed-test'
      const filepath = getSessionFilePath(sessionId, config())

      // Manually write a file with a malformed line
      const { writeFileSync } = require('fs')
      const lines = [
        JSON.stringify({ type: 'metadata', timestamp: 'now', metadata: { sessionId, model: 'test', createdAt: 'now' } }),
        'this is not valid json',
        JSON.stringify({ type: 'message', timestamp: 'now', message: { role: 'user', content: 'works' } }),
      ]
      writeFileSync(filepath, lines.join('\n') + '\n')

      const loaded = loadSession(sessionId, config())
      expect(loaded).not.toBeNull()
      expect(loaded!.messages).toHaveLength(1)
      expect(loaded!.messages[0]).toEqual({ role: 'user', content: 'works' })
    })
  })

  describe('listSessions', () => {
    it('lists all sessions sorted by createdAt descending', () => {
      // Create two sessions
      appendEntry('session-old', {
        type: 'metadata',
        timestamp: '2025-01-01T00:00:00.000Z',
        metadata: { sessionId: 'session-old', model: 'test', createdAt: '2025-01-01T00:00:00.000Z' },
      }, config())

      appendEntry('session-new', {
        type: 'metadata',
        timestamp: '2025-06-01T00:00:00.000Z',
        metadata: { sessionId: 'session-new', model: 'test', createdAt: '2025-06-01T00:00:00.000Z' },
      }, config())

      const sessions = listSessions(config())
      expect(sessions).toHaveLength(2)
      expect(sessions[0]!.sessionId).toBe('session-new')
      expect(sessions[1]!.sessionId).toBe('session-old')
    })

    it('returns empty array for empty directory', () => {
      const sessions = listSessions(config())
      expect(sessions).toEqual([])
    })
  })

  describe('JSONL file format', () => {
    it('writes one JSON object per line', () => {
      const sessionId = 'format-test'
      appendEntry(sessionId, {
        type: 'metadata',
        timestamp: 'now',
        metadata: { sessionId, model: 'test', createdAt: 'now' },
      }, config())
      appendEntry(sessionId, {
        type: 'message',
        timestamp: 'now',
        message: { role: 'user', content: 'hello' },
      }, config())

      const filepath = getSessionFilePath(sessionId, config())
      const content = readFileSync(filepath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      expect(lines).toHaveLength(2)

      // Each line is valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })
  })
})
