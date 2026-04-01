/**
 * agent-core — SDK for building AI coding agents
 *
 * Extracted from codenano's core Agent loop architecture.
 *
 * @example
 * ```typescript
 * import { createAgent, defineTool } from 'agent-core'
 * import { z } from 'zod'
 *
 * const agent = createAgent({
 *   model: 'claude-sonnet-4-6',
 *   tools: [
 *     defineTool({
 *       name: 'ReadFile',
 *       description: 'Read a file',
 *       input: z.object({ path: z.string() }),
 *       execute: async ({ path }) => fs.readFileSync(path, 'utf-8'),
 *     }),
 *   ],
 *   systemPrompt: 'You are a helpful coding assistant.',
 * })
 *
 * const result = await agent.ask('Read main.ts')
 * ```
 */

// ── Factory functions ───────────────────────────────────────────────────────
export { createAgent } from './agent.js'
export { defineTool } from './tool-builder.js'

// ── Prompt system ──────────────────────────────────────────────────────────
export {
  // Builder
  buildSystemPrompt,
  buildEffectiveSystemPrompt,
  simplePrompt,
  enhancePromptWithEnv,

  // Section system
  systemPromptSection,
  uncachedSection,
  resolveSections,
  clearSections,

  // Individual sections
  getIntroSection,
  getSystemSection,
  getTasksSection,
  getActionsSection,
  getToolsSection,
  getToneSection,
  getEfficiencySection,
  getEnvironmentSection,
  getLanguageSection,
  getOutputStyleSection,
  customSection,
  detectEnvironment,

  // Constants
  DEFAULT_IDENTITY,
  CLAUDE_CODE_IDENTITY,
  CLAUDE_CODE_SDK_IDENTITY,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  SUMMARIZE_TOOL_RESULTS_SECTION,

  // Utilities
  prependBullets,
  joinSections,
} from './prompt/index.js'

export type {
  SystemPrompt,
  PromptConfig,
  EffectivePromptOptions,
  PromptSection,
  SectionComputeFn,
  PromptPriority,
  EnvironmentInfo,
  OutputStyleConfig,
} from './prompt/index.js'

// ── Built-in Tools ─────────────────────────────────────────────────────────
export {
  // Tool presets
  coreTools,
  extendedTools,
  allTools,

  // Individual tools — fully functional
  FileReadTool,
  FileEditTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  BashTool,
  NotebookEditTool,
  WebFetchTool,
  BriefTool,

  // Individual tools — with default backend
  TaskCreateTool,
  TaskUpdateTool,
  TaskGetTool,
  TaskListTool,
  TaskStopTool,
  TodoWriteTool,

  // Individual tools — schema stubs (need execute override)
  WebSearchTool,
  LSPTool,
  AgentTool as AgentToolDef,
  AskUserTool,
  SkillTool,
} from './tools/index.js'

// ── Compact / Token Management ────────────────────────────────────────────
export {
  estimateTokens,
  shouldAutoCompact,
  compactMessages,
  isPromptTooLongError,
} from './compact.js'

// ── CLAUDE.md Instructions ────────────────────────────────────────────────
export {
  loadInstructions,
  discoverInstructionFiles,
  formatInstructions,
} from './instructions.js'

export type {
  InstructionFile,
  LoadInstructionsOptions,
} from './instructions.js'

// ── Tool Result Budgeting ─────────────────────────────────────────────────
export {
  truncateToolResult,
  applyMessageBudget,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_BYTES,
} from './tool-budget.js'

// ── Provider Utilities ────────────────────────────────────────────────────
export {
  FallbackTriggeredError,
  getRetryDelay,
  CAPPED_DEFAULT_MAX_TOKENS,
  ESCALATED_MAX_TOKENS,
} from './provider.js'

// ── Streaming Tool Executor ──────────────────────────────────────────────
export { StreamingToolExecutor } from './streaming-tool-executor.js'
export type { ToolExecutionResult } from './streaming-tool-executor.js'

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  // Agent & Session
  Agent,
  Session,
  AgentConfig,
  Result,
  Usage,

  // Tool definition
  ToolDef,
  ToolContext,
  ToolOutput,

  // Stream events
  StreamEvent,

  // Messages
  MessageParam,
  ContentBlock,

  // Permission system
  PermissionFn,
  PermissionDecision,

  // Hooks
  StopHookFn,
  StopHookResult,
} from './types.js'
