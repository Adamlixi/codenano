/**
 * session-storage.ts — JSONL-based session persistence
 *
 * Follows Claude Code's design: each session is a JSONL file where each line
 * is a self-describing entry (message or metadata). Append-only writes,
 * line-by-line reads for restore.
 */

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { MessageParam } from './types.js'

// ─── Types ─────────────────────────────────────────────────────────────────

/** Configuration for session persistence */
export interface SessionPersistConfig {
  /** Enable persistence. Default: false */
  enabled: boolean
  /** Directory to store session JSONL files. Default: ~/.agent-core/sessions/ */
  storageDir?: string
  /** Existing session ID to resume. Loads messages from the JSONL file. */
  resumeSessionId?: string
}

/** Session metadata stored as the first entry in the JSONL file */
export interface SessionMetadata {
  sessionId: string
  model: string
  createdAt: string
  /** Optional user-provided label */
  label?: string
}

/** A single entry in the JSONL transcript file */
export interface TranscriptEntry {
  /** Entry type discriminator */
  type: 'message' | 'metadata'
  /** ISO-8601 timestamp */
  timestamp: string
  /** For type='message': the conversation message */
  message?: { role: string; content: unknown }
  /** For type='metadata': session-level info */
  metadata?: SessionMetadata
}

/** Result of loading a persisted session */
export interface LoadedSession {
  metadata: SessionMetadata
  messages: MessageParam[]
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_SESSIONS_DIR = join(homedir(), '.agent-core', 'sessions')

// ─── Functions ─────────────────────────────────────────────────────────────

/** Get the session storage directory, creating it if needed */
export function getSessionStorageDir(config?: Pick<SessionPersistConfig, 'storageDir'>): string {
  const dir = config?.storageDir ? resolve(config.storageDir) : DEFAULT_SESSIONS_DIR
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Get the JSONL file path for a session */
export function getSessionFilePath(
  sessionId: string,
  config?: Pick<SessionPersistConfig, 'storageDir'>,
): string {
  return join(getSessionStorageDir(config), `${sessionId}.jsonl`)
}

/** Append a single entry to the session's JSONL file */
export function appendEntry(
  sessionId: string,
  entry: TranscriptEntry,
  config?: Pick<SessionPersistConfig, 'storageDir'>,
): void {
  const filepath = getSessionFilePath(sessionId, config)
  appendFileSync(filepath, JSON.stringify(entry) + '\n', 'utf-8')
}

/** Load a persisted session by ID. Returns null if not found. */
export function loadSession(
  sessionId: string,
  config?: Pick<SessionPersistConfig, 'storageDir'>,
): LoadedSession | null {
  const filepath = getSessionFilePath(sessionId, config)
  if (!existsSync(filepath)) return null

  const content = readFileSync(filepath, 'utf-8')
  const lines = content.split('\n').filter(line => line.trim())

  let metadata: SessionMetadata | null = null
  const messages: MessageParam[] = []

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry
      if (entry.type === 'metadata' && entry.metadata) {
        metadata = entry.metadata
      } else if (entry.type === 'message' && entry.message) {
        messages.push(entry.message as MessageParam)
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (!metadata) return null
  return { metadata, messages }
}

/** List all saved sessions. Only parses the first line (metadata) of each file. */
export function listSessions(
  config?: Pick<SessionPersistConfig, 'storageDir'>,
): SessionMetadata[] {
  const dir = getSessionStorageDir(config)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  const sessions: SessionMetadata[] = []

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8')
      const firstLine = content.split('\n')[0]
      if (!firstLine) continue
      const entry = JSON.parse(firstLine) as TranscriptEntry
      if (entry.type === 'metadata' && entry.metadata) {
        sessions.push(entry.metadata)
      }
    } catch {
      // Skip unreadable files
    }
  }

  return sessions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}
