/**
 * Task Tools — Create, update, get, list, and stop tasks.
 *
 * Extracted from Claude Code:
 *   src/tools/TaskCreateTool/TaskCreateTool.ts
 *   src/tools/TaskUpdateTool/TaskUpdateTool.ts
 *   src/tools/TaskGetTool/TaskGetTool.ts
 *   src/tools/TaskListTool/TaskListTool.ts
 *   src/tools/TaskStopTool/TaskStopTool.ts
 *
 * These are schema definitions for task management tools.
 * SDK users should provide their own task storage backend.
 */

import { z } from 'zod'
import { defineTool } from '../tool-builder.js'

// ─── In-memory task store (simple default) ──────────────────────────────────

interface Task {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner?: string
  blockedBy: string[]
  blocks: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

let nextId = 1
const tasks = new Map<string, Task>()

// ─── TaskCreateTool ─────────────────────────────────────────────────────────

const taskCreateInput = z.object({
  subject: z.string().describe('A brief title for the task'),
  description: z.string().describe('What needs to be done'),
  activeForm: z.string().optional().describe('Present continuous form of what will happen (e.g., "Running tests")'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata to attach to the task'),
})

export type TaskCreateInput = z.infer<typeof taskCreateInput>

export const TaskCreateTool = defineTool({
  name: 'TaskCreate',
  description: 'Create a new task in the task list.',
  input: taskCreateInput,

  async execute(input) {
    const id = String(nextId++)
    const task: Task = {
      id,
      subject: input.subject,
      description: input.description,
      status: 'pending',
      blockedBy: [],
      blocks: [],
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    tasks.set(id, task)
    return JSON.stringify({ id, subject: task.subject, status: task.status })
  },
})

// ─── TaskUpdateTool ─────────────────────────────────────────────────────────

const taskUpdateInput = z.object({
  taskId: z.string().describe('The ID of the task to update'),
  subject: z.string().optional().describe('New subject for the task'),
  description: z.string().optional().describe('New description for the task'),
  activeForm: z.string().optional().describe('Present continuous form'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'deleted'])
    .optional()
    .describe('New status for the task'),
  addBlocks: z.array(z.string()).optional().describe('Task IDs that this task blocks'),
  addBlockedBy: z.array(z.string()).optional().describe('Task IDs that block this task'),
  owner: z.string().optional().describe('New owner for the task'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata to merge'),
})

export type TaskUpdateInput = z.infer<typeof taskUpdateInput>

export const TaskUpdateTool = defineTool({
  name: 'TaskUpdate',
  description: 'Update an existing task.',
  input: taskUpdateInput,

  async execute(input) {
    const task = tasks.get(input.taskId)
    if (!task) {
      return { content: `Error: Task ${input.taskId} not found`, isError: true }
    }

    if (input.subject) task.subject = input.subject
    if (input.description) task.description = input.description
    if (input.status) task.status = input.status
    if (input.owner) task.owner = input.owner
    if (input.addBlocks) task.blocks.push(...input.addBlocks)
    if (input.addBlockedBy) task.blockedBy.push(...input.addBlockedBy)
    if (input.metadata) Object.assign(task.metadata, input.metadata)
    task.updatedAt = new Date().toISOString()

    return JSON.stringify({ id: task.id, subject: task.subject, status: task.status })
  },
})

// ─── TaskGetTool ────────────────────────────────────────────────────────────

const taskGetInput = z.object({
  taskId: z.string().describe('The ID of the task to retrieve'),
})

export type TaskGetInput = z.infer<typeof taskGetInput>

export const TaskGetTool = defineTool({
  name: 'TaskGet',
  description: 'Retrieve a task by its ID.',
  input: taskGetInput,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input) {
    const task = tasks.get(input.taskId)
    if (!task) {
      return { content: `Error: Task ${input.taskId} not found`, isError: true }
    }
    return JSON.stringify(task, null, 2)
  },
})

// ─── TaskListTool ───────────────────────────────────────────────────────────

const taskListInput = z.object({})

export type TaskListInput = z.infer<typeof taskListInput>

export const TaskListTool = defineTool({
  name: 'TaskList',
  description: 'List all tasks in the current session.',
  input: taskListInput,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute() {
    const allTasks = Array.from(tasks.values())
      .filter(t => t.status !== 'deleted')
      .map(t => ({ id: t.id, subject: t.subject, status: t.status, owner: t.owner }))

    if (allTasks.length === 0) return 'No tasks found.'
    return JSON.stringify(allTasks, null, 2)
  },
})

// ─── TaskStopTool ───────────────────────────────────────────────────────────

const taskStopInput = z.object({
  task_id: z.string().describe('The task ID or background process ID to stop'),
})

export type TaskStopInput = z.infer<typeof taskStopInput>

export const TaskStopTool = defineTool({
  name: 'TaskStop',
  description: 'Stop or kill a running background task.',
  input: taskStopInput,
  isConcurrencySafe: true,

  async execute(input) {
    const task = tasks.get(input.task_id)
    if (task) {
      task.status = 'deleted'
      task.updatedAt = new Date().toISOString()
      return JSON.stringify({ message: `Task ${input.task_id} stopped`, task_id: input.task_id })
    }
    return { content: `Error: Task ${input.task_id} not found`, isError: true }
  },
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Reset task store (for testing) */
export function resetTaskStore(): void {
  tasks.clear()
  nextId = 1
}
