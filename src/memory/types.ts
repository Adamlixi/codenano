/**
 * Memory types for agent memory system
 */

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface Memory {
  name: string
  description: string
  type: MemoryType
  content: string
}

/**
 * Memory extraction strategy:
 * - 'disabled': No automatic extraction (default)
 * - 'auto': Extract after every turn that has no tool use (like Claude Code)
 * - { interval: N }: Extract every N turns
 */
export type ExtractStrategy =
  | 'disabled'
  | 'auto'
  | { interval: number }

export interface MemoryConfig {
  /** Custom memory directory path. Defaults to ~/.agent-core/memory/<project-hash>/ */
  memoryDir?: string
  /** Auto-load memories into system prompt. Default: true */
  autoLoad?: boolean
  /**
   * Memory extraction strategy. Default: 'disabled'
   * - 'disabled': No automatic extraction
   * - 'auto': Extract after every turn (fire-and-forget)
   * - { interval: N }: Extract every N completed turns
   */
  extractStrategy?: ExtractStrategy
  /** Max turns for the extraction agent. Default: 3 */
  extractMaxTurns?: number
}
