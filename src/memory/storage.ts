/**
 * Memory storage utilities
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import type { Memory, MemoryType } from './types.js'

const DEFAULT_MEMORY_BASE = join(homedir(), '.agent-core', 'memory')

export function getMemoryDir(customDir?: string): string {
  if (customDir) {
    return resolve(customDir)
  }

  const projectHash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 8)
  return join(DEFAULT_MEMORY_BASE, projectHash)
}

export function saveMemory(memory: Memory, memoryDir?: string): string {
  const dir = getMemoryDir(memoryDir)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filename = `${memory.name.replace(/[^a-z0-9_-]/gi, '_')}.md`
  const filepath = join(dir, filename)

  const content = `---
name: ${memory.name}
description: ${memory.description}
type: ${memory.type}
---

${memory.content}
`

  writeFileSync(filepath, content, 'utf-8')
  return filepath
}

export function loadMemory(filepath: string): Memory | null {
  try {
    const content = readFileSync(filepath, 'utf-8')
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!match) return null

    const frontmatter = match[1]
    const body = match[2].trim()

    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]
    const type = frontmatter.match(/^type:\s*(.+)$/m)?.[1] as MemoryType

    if (!name || !description || !type) return null

    return { name, description, type, content: body }
  } catch {
    return null
  }
}

export function scanMemories(memoryDir?: string): Memory[] {
  const dir = getMemoryDir(memoryDir)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
    .map(f => join(dir, f))

  return files.map(loadMemory).filter((m): m is Memory => m !== null)
}

export function loadMemoryIndex(memoryDir?: string): string | null {
  const dir = getMemoryDir(memoryDir)
  const indexPath = join(dir, 'MEMORY.md')

  if (!existsSync(indexPath)) return null
  return readFileSync(indexPath, 'utf-8')
}
