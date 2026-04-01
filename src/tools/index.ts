/**
 * tools/index.ts — Barrel export for all extracted codenano tools.
 *
 * Tools are organized into three tiers:
 *
 * 1. **Fully functional** — work out of the box (file ops, search, bash)
 * 2. **Default backend** — work with built-in simple storage (tasks, todos)
 * 3. **Schema stubs** — need user-provided execute (web search, LSP, agent, skill)
 *
 * Usage:
 * ```typescript
 * import { createAgent, coreTools } from 'agent-core'
 *
 * const agent = createAgent({
 *   model: 'claude-sonnet-4-6',
 *   tools: coreTools(),
 * })
 * ```
 */

import type { ToolDef } from '../types.js'

// ── Fully functional tools ──────────────────────────────────────────────────

export { FileReadTool } from './FileReadTool.js'
export type { FileReadInput } from './FileReadTool.js'

export { FileEditTool } from './FileEditTool.js'
export type { FileEditInput } from './FileEditTool.js'

export { FileWriteTool } from './FileWriteTool.js'
export type { FileWriteInput } from './FileWriteTool.js'

export { GlobTool } from './GlobTool.js'
export type { GlobInput } from './GlobTool.js'

export { GrepTool } from './GrepTool.js'
export type { GrepInput } from './GrepTool.js'

export { BashTool } from './BashTool.js'
export type { BashInput } from './BashTool.js'

export { NotebookEditTool } from './NotebookEditTool.js'
export type { NotebookEditInput } from './NotebookEditTool.js'

export { WebFetchTool } from './WebFetchTool.js'
export type { WebFetchInput } from './WebFetchTool.js'

export { BriefTool } from './BriefTool.js'
export type { BriefInput } from './BriefTool.js'

// ── Default backend tools ───────────────────────────────────────────────────

export {
  TaskCreateTool,
  TaskUpdateTool,
  TaskGetTool,
  TaskListTool,
  TaskStopTool,
  resetTaskStore,
} from './TaskTools.js'
export type {
  TaskCreateInput,
  TaskUpdateInput,
  TaskGetInput,
  TaskListInput,
  TaskStopInput,
} from './TaskTools.js'

export { TodoWriteTool, getCurrentTodos, resetTodos } from './TodoWriteTool.js'
export type { TodoWriteInput } from './TodoWriteTool.js'

// ── Schema stubs (need user-provided execute) ───────────────────────────────

export { WebSearchTool } from './WebSearchTool.js'
export type { WebSearchInput } from './WebSearchTool.js'

export { LSPTool } from './LSPTool.js'
export type { LSPInput } from './LSPTool.js'

export { AgentTool } from './AgentTool.js'
export type { AgentToolInput } from './AgentTool.js'

export { AskUserTool } from './AskUserTool.js'
export type { AskUserInput } from './AskUserTool.js'

export { SkillTool } from './SkillTool.js'
export type { SkillInput } from './SkillTool.js'

// ── Presets ─────────────────────────────────────────────────────────────────

import { FileReadTool } from './FileReadTool.js'
import { FileEditTool } from './FileEditTool.js'
import { FileWriteTool } from './FileWriteTool.js'
import { GlobTool } from './GlobTool.js'
import { GrepTool } from './GrepTool.js'
import { BashTool } from './BashTool.js'
import { NotebookEditTool } from './NotebookEditTool.js'
import { WebFetchTool } from './WebFetchTool.js'
import { BriefTool } from './BriefTool.js'
import {
  TaskCreateTool,
  TaskUpdateTool,
  TaskGetTool,
  TaskListTool,
  TaskStopTool,
} from './TaskTools.js'
import { TodoWriteTool } from './TodoWriteTool.js'
import { WebSearchTool } from './WebSearchTool.js'
import { LSPTool } from './LSPTool.js'
import { AgentTool } from './AgentTool.js'
import { AskUserTool } from './AskUserTool.js'
import { SkillTool } from './SkillTool.js'

/**
 * Core coding tools — the essential set for a coding agent.
 * Includes: Read, Edit, Write, Glob, Grep, Bash.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function coreTools(): ToolDef<any>[] {
  return [FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool, BashTool]
}

/**
 * Extended tools — core + notebooks, web fetch, brief, tasks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extendedTools(): ToolDef<any>[] {
  return [
    ...coreTools(),
    NotebookEditTool,
    WebFetchTool,
    BriefTool,
    TaskCreateTool,
    TaskUpdateTool,
    TaskGetTool,
    TaskListTool,
    TaskStopTool,
    TodoWriteTool,
  ]
}

/**
 * All tools — every extracted tool including stubs.
 * Stubs (WebSearch, LSP, Agent, AskUser, Skill) will return errors
 * unless you override their execute functions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function allTools(): ToolDef<any>[] {
  return [...extendedTools(), WebSearchTool, LSPTool, AgentTool, AskUserTool, SkillTool]
}
