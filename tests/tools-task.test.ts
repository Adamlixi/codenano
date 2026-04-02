/**
 * Unit tests for TaskTools, TodoWriteTool, and stub tools
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TaskCreateTool,
  TaskUpdateTool,
  TaskGetTool,
  TaskListTool,
  TaskStopTool,
  resetTaskStore,
} from '../src/tools/TaskTools.js'
import { TodoWriteTool, getCurrentTodos, resetTodos } from '../src/tools/TodoWriteTool.js'
import { WebSearchTool } from '../src/tools/WebSearchTool.js'
import { LSPTool } from '../src/tools/LSPTool.js'
import { AgentTool } from '../src/tools/AgentTool.js'
import { AskUserTool } from '../src/tools/AskUserTool.js'
import { SkillTool } from '../src/tools/SkillTool.js'

const signal = new AbortController().signal
const ctx = { signal, messages: [] }

// ─── TaskTools ─────────────────────────────────────────────────────────────

describe('TaskTools', () => {
  beforeEach(() => { resetTaskStore() })

  it('creates a task', async () => {
    const result = await TaskCreateTool.execute(
      { subject: 'Fix bug', description: 'Fix the login bug' },
      ctx,
    )
    const parsed = JSON.parse(result as string)
    expect(parsed.id).toBe('1')
    expect(parsed.subject).toBe('Fix bug')
    expect(parsed.status).toBe('pending')
  })

  it('creates tasks with incrementing IDs', async () => {
    await TaskCreateTool.execute({ subject: 'A', description: 'a' }, ctx)
    const r2 = await TaskCreateTool.execute({ subject: 'B', description: 'b' }, ctx)
    expect(JSON.parse(r2 as string).id).toBe('2')
  })

  it('updates a task', async () => {
    await TaskCreateTool.execute({ subject: 'Task', description: 'desc' }, ctx)
    const result = await TaskUpdateTool.execute(
      { taskId: '1', status: 'in_progress', subject: 'Updated' },
      ctx,
    )
    const parsed = JSON.parse(result as string)
    expect(parsed.status).toBe('in_progress')
    expect(parsed.subject).toBe('Updated')
  })

  it('update returns error for missing task', async () => {
    const result = await TaskUpdateTool.execute({ taskId: '999' }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })

  it('updates blocks and blockedBy', async () => {
    await TaskCreateTool.execute({ subject: 'A', description: 'a' }, ctx)
    await TaskCreateTool.execute({ subject: 'B', description: 'b' }, ctx)
    await TaskUpdateTool.execute({ taskId: '1', addBlocks: ['2'] }, ctx)
    await TaskUpdateTool.execute({ taskId: '2', addBlockedBy: ['1'] }, ctx)

    const r1 = JSON.parse(await TaskGetTool.execute({ taskId: '1' }, ctx) as string)
    const r2 = JSON.parse(await TaskGetTool.execute({ taskId: '2' }, ctx) as string)
    expect(r1.blocks).toContain('2')
    expect(r2.blockedBy).toContain('1')
  })

  it('updates metadata', async () => {
    await TaskCreateTool.execute({ subject: 'T', description: 'd', metadata: { a: 1 } }, ctx)
    await TaskUpdateTool.execute({ taskId: '1', metadata: { b: 2 } }, ctx)
    const task = JSON.parse(await TaskGetTool.execute({ taskId: '1' }, ctx) as string)
    expect(task.metadata).toEqual({ a: 1, b: 2 })
  })

  it('gets a task by ID', async () => {
    await TaskCreateTool.execute({ subject: 'My Task', description: 'details' }, ctx)
    const result = await TaskGetTool.execute({ taskId: '1' }, ctx)
    const parsed = JSON.parse(result as string)
    expect(parsed.subject).toBe('My Task')
    expect(parsed.description).toBe('details')
  })

  it('get returns error for missing task', async () => {
    const result = await TaskGetTool.execute({ taskId: '999' }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })

  it('lists all non-deleted tasks', async () => {
    await TaskCreateTool.execute({ subject: 'A', description: 'a' }, ctx)
    await TaskCreateTool.execute({ subject: 'B', description: 'b' }, ctx)
    await TaskUpdateTool.execute({ taskId: '2', status: 'deleted' }, ctx)

    const result = await TaskListTool.execute({}, ctx)
    const parsed = JSON.parse(result as string)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].subject).toBe('A')
  })

  it('list returns message when empty', async () => {
    const result = await TaskListTool.execute({}, ctx)
    expect(result).toBe('No tasks found.')
  })

  it('stops a task', async () => {
    await TaskCreateTool.execute({ subject: 'Running', description: 'r' }, ctx)
    const result = await TaskStopTool.execute({ task_id: '1' }, ctx)
    const parsed = JSON.parse(result as string)
    expect(parsed.message).toContain('stopped')
  })

  it('stop returns error for missing task', async () => {
    const result = await TaskStopTool.execute({ task_id: '999' }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('not found'), isError: true })
  })
})

// ─── TodoWriteTool ─────────────────────────────────────────────────────────

describe('TodoWriteTool', () => {
  beforeEach(() => { resetTodos() })

  it('writes todos and returns formatted list', async () => {
    const result = await TodoWriteTool.execute({
      todos: [
        { id: '1', content: 'Buy milk', status: 'pending' },
        { id: '2', content: 'Write tests', status: 'in_progress' },
        { id: '3', content: 'Deploy', status: 'completed' },
      ],
    }, ctx)
    expect(result).toContain('[ ] Buy milk')
    expect(result).toContain('[~] Write tests')
    expect(result).toContain('[x] Deploy')
  })

  it('returns cleared message for empty list', async () => {
    const result = await TodoWriteTool.execute({ todos: [] }, ctx)
    expect(result).toBe('Todo list cleared.')
  })

  it('getCurrentTodos returns current state', async () => {
    await TodoWriteTool.execute({
      todos: [{ id: '1', content: 'Test', status: 'pending' }],
    }, ctx)
    const todos = getCurrentTodos()
    expect(todos).toHaveLength(1)
    expect(todos[0].content).toBe('Test')
  })

  it('resetTodos clears state', async () => {
    await TodoWriteTool.execute({
      todos: [{ id: '1', content: 'Test', status: 'pending' }],
    }, ctx)
    resetTodos()
    expect(getCurrentTodos()).toHaveLength(0)
  })
})

// ─── Stub Tools ────────────────────────────────────────────────────────────

describe('Stub tools return error by default', () => {
  it('WebSearchTool', async () => {
    const result = await WebSearchTool.execute({ query: 'test' }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('requires'), isError: true })
  })

  it('LSPTool', async () => {
    const result = await LSPTool.execute(
      { operation: 'hover', filePath: 'f.ts', line: 1, character: 1 },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('requires'), isError: true })
  })

  it('AgentTool', async () => {
    const result = await AgentTool.execute(
      { description: 'test', prompt: 'do something' },
      ctx,
    )
    expect(result).toEqual({ content: expect.stringContaining('requires'), isError: true })
  })

  it('AskUserTool', async () => {
    const result = await AskUserTool.execute({ question: 'hello?' }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('requires'), isError: true })
  })

  it('SkillTool', async () => {
    const result = await SkillTool.execute({ skill: 'commit' }, ctx)
    expect(result).toEqual({ content: expect.stringContaining('requires'), isError: true })
  })
})
