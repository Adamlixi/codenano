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

export interface MemoryConfig {
  memoryDir?: string
  autoLoad?: boolean
}
