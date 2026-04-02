/**
 * Memory section for system prompt
 */

import { scanMemories, loadMemoryIndex, buildMemoryPrompt } from '../../memory/index.js'

export function getMemorySection(memoryDir?: string): string | null {
  try {
    const memories = scanMemories(memoryDir)
    const indexContent = loadMemoryIndex(memoryDir)

    if (memories.length === 0 && !indexContent) return null

    return buildMemoryPrompt(memories, indexContent)
  } catch {
    return null
  }
}
