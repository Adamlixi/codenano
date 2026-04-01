/**
 * TodoWriteTool — Manage session task checklist (V1 legacy).
 *
 * Extracted from Claude Code: src/tools/TodoWriteTool/TodoWriteTool.ts
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

const todoItemSchema = z.object({
  id: z.string().describe('Unique ID for the todo item'),
  content: z.string().describe('The todo item text'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status'),
})

const inputSchema = z.object({
  todos: z.array(todoItemSchema).describe('The complete updated todo list'),
})

export type TodoWriteInput = z.infer<typeof inputSchema>

// In-memory store
let currentTodos: z.infer<typeof todoItemSchema>[] = []

export const TodoWriteTool = defineTool({
  name: 'TodoWrite',
  description: 'Manage the session task checklist. Write the complete list of todos each time.',
  input: inputSchema,

  async execute(input) {
    currentTodos = input.todos
    const summary = input.todos.map(t => {
      const icon = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]'
      return `${icon} ${t.content}`
    }).join('\n')

    return summary || 'Todo list cleared.'
  },
})

/** Get current todos (for testing/inspection) */
export function getCurrentTodos() {
  return [...currentTodos]
}

/** Reset todos (for testing) */
export function resetTodos() {
  currentTodos = []
}
