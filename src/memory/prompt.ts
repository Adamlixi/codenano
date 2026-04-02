/**
 * Memory prompt generation
 */

import type { Memory } from './types.js'

export function buildMemoryPrompt(memories: Memory[], indexContent?: string | null): string {
  if (memories.length === 0 && !indexContent) return ''

  let prompt = '# auto memory\n\n'
  prompt += 'You have a persistent, file-based memory system. '
  prompt += 'This directory already exists — write to it directly.\n\n'
  prompt += '## Types of memory\n\n'
  prompt += '- **user**: Information about the user\'s role, preferences, and knowledge\n'
  prompt += '- **feedback**: Guidance on how to approach work (what to avoid or repeat)\n'
  prompt += '- **project**: Project state, goals, and events (not derivable from code)\n'
  prompt += '- **reference**: Pointers to external systems\n\n'

  if (indexContent) {
    prompt += '## Memory Index\n\n'
    prompt += indexContent + '\n\n'
  }

  if (memories.length > 0) {
    prompt += `## Loaded Memories (${memories.length})\n\n`
    for (const mem of memories) {
      prompt += `### ${mem.name} (${mem.type})\n${mem.description}\n\n`
    }
  }

  return prompt
}
