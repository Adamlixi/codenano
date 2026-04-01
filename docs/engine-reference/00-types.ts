/**
 * 00-types.ts — 核心类型定义
 *
 * 源自:
 *   src/Tool.ts            — Tool, ToolUseContext, ToolResult
 *   src/Task.ts            — TaskType, TaskStatus, TaskContext
 *   src/types/message.ts   — Message (简化)
 *   src/query.ts           — QueryParams, State
 *   src/query/deps.ts      — QueryDeps
 *   src/query/config.ts    — QueryConfig
 *   src/QueryEngine.ts     — QueryEngineConfig
 *   src/hooks/useCanUseTool.ts — CanUseToolFn
 */

import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { z } from 'zod/v4'

// ─── Message Types (简化自 types/message.ts) ─────────────────────────────────

export type AssistantMessage = {
  type: 'assistant'
  uuid: UUID
  message: {
    id: string
    role: 'assistant'
    content: ContentBlockParam[]
    stop_reason: string | null
    usage?: Record<string, number>
  }
  requestId?: string
  isApiErrorMessage?: boolean
  apiError?: string
  timestamp: number
}

export type UserMessage = {
  type: 'user'
  uuid: UUID
  message: {
    role: 'user'
    content: string | ContentBlockParam[]
  }
  isMeta?: boolean
  toolUseResult?: unknown
  sourceToolAssistantUUID?: UUID
  imagePasteIds?: number[]
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  timestamp: number
}

export type SystemMessage = {
  type: 'system'
  uuid: UUID
  subtype?: string
  content?: string
  compactMetadata?: Record<string, unknown>
  timestamp: number
  [key: string]: unknown
}

export type AttachmentMessage = {
  type: 'attachment'
  uuid: UUID
  attachment: {
    type: string
    [key: string]: unknown
  }
  timestamp: number
}

export type ProgressMessage = {
  type: 'progress'
  uuid: UUID
  toolUseID?: string
  data?: unknown
  timestamp: number
}

export type StreamEvent = {
  type: 'stream_event'
  event: {
    type: string
    message?: { usage?: Record<string, number> }
    usage?: Record<string, number>
    delta?: { stop_reason?: string }
    [key: string]: unknown
  }
}

export type RequestStartEvent = {
  type: 'stream_request_start'
}

export type TombstoneMessage = {
  type: 'tombstone'
  message: AssistantMessage
}

export type ToolUseSummaryMessage = {
  type: 'tool_use_summary'
  uuid: UUID
  summary: string
  precedingToolUseIds: string[]
}

/**
 * 所有消息类型的联合
 */
export type Message =
  | AssistantMessage
  | UserMessage
  | SystemMessage
  | AttachmentMessage
  | ProgressMessage

// ─── Tool Types (简化自 Tool.ts) ─────────────────────────────────────────────

export type ToolInputJSONSchema = {
  [x: string]: unknown
  type: 'object'
  properties?: { [x: string]: unknown }
}

export type AnyObject = z.ZodType<{ [key: string]: unknown }>

export type ToolResult<T> = {
  data: T
  newMessages?: Message[]
  contextModifier?: (context: ToolUseContext) => ToolUseContext
}

export type ToolProgress<P = unknown> = {
  toolUseID: string
  data: P
}

export type ToolCallProgress = (progress: ToolProgress) => void

export type ValidationResult =
  | { result: true }
  | { result: false; message: string; errorCode: number }

/**
 * Permission check result for a tool invocation.
 * 源自 types/permissions.ts
 */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: unknown; userModified?: boolean; acceptFeedback?: string; contentBlocks?: ContentBlockParam[]; decisionReason?: PermissionDecisionReason }
  | { behavior: 'deny'; message: string; decisionReason?: PermissionDecisionReason }
  | { behavior: 'ask'; message: string; contentBlocks?: ContentBlockParam[]; decisionReason?: PermissionDecisionReason }

export type PermissionDecisionReason =
  | { type: 'rule'; rule: { source: string } }
  | { type: 'hook'; hookName?: string }
  | { type: 'mode' }
  | { type: 'classifier'; classifier?: string; reason?: string }
  | { type: 'permissionPromptTool'; toolResult?: unknown }
  | { type: 'subcommandResults' }
  | { type: 'asyncAgent' }
  | { type: 'sandboxOverride' }
  | { type: 'workingDir' }
  | { type: 'safetyCheck' }
  | { type: 'other' }

/**
 * Tool 接口 — 简化版，保留核心调用逻辑
 * 源自 Tool.ts 的 Tool 类型
 */
export type Tool = {
  readonly name: string
  aliases?: string[]
  readonly inputSchema: AnyObject
  readonly inputJSONSchema?: ToolInputJSONSchema
  maxResultSizeChars: number

  /** 执行工具 */
  call(
    args: unknown,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress,
  ): Promise<ToolResult<unknown>>

  /** 工具描述 (用于 system prompt) */
  prompt(options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
  }): Promise<string>

  /** Zod 输入验证 */
  validateInput?(args: unknown, context: ToolUseContext): Promise<ValidationResult>

  /** 权限检查 */
  checkPermissions(args: unknown, context: ToolUseContext): Promise<PermissionResult>

  /** 工具描述生成 */
  description(input: unknown, options: unknown): Promise<string>

  /** 是否并发安全 (如 Read / Glob) */
  isConcurrencySafe(input: unknown): boolean

  /** 是否只读操作 */
  isReadOnly(input: unknown): boolean

  /** 是否已启用 */
  isEnabled(): boolean

  /** 将工具结果映射到 API 格式 */
  mapToolResultToToolResultBlockParam(
    content: unknown,
    toolUseID: string,
  ): ToolResultBlockParam

  /** 可选：输入回填 (扩展 file_path 等) */
  backfillObservableInput?(input: Record<string, unknown>): void

  /** UI 展示名 */
  userFacingName(input: unknown): string

  isMcp?: boolean
  readonly shouldDefer?: boolean
}

export type Tools = readonly Tool[]

// ─── CanUseTool (简化自 hooks/useCanUseTool.ts) ──────────────────────────────

export type CanUseToolFn = (
  tool: Tool,
  input: unknown,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: unknown,
) => Promise<PermissionResult>

// ─── ToolUseContext (简化自 Tool.ts) ──────────────────────────────────────────

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'disabled' }

export type AgentDefinition = {
  agentType: string
  whenToUse: string
  source: string
  getSystemPrompt: () => string
}

export type PermissionMode = 'default' | 'plan' | 'auto' | 'bypassPermissions'

export type ToolPermissionContext = {
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, unknown>
  alwaysAllowRules: Record<string, unknown>
  alwaysDenyRules: Record<string, unknown>
  alwaysAskRules: Record<string, unknown>
  isBypassPermissionsModeAvailable: boolean
  shouldAvoidPermissionPrompts?: boolean
}

export type QueryChainTracking = {
  chainId: string
  depth: number
}

export type FileStateCache = Map<string, unknown>

export type AppState = {
  toolPermissionContext: ToolPermissionContext
  fastMode?: boolean
  mcp: {
    clients: Array<{ name: string; type: string; config?: unknown }>
    tools: unknown[]
  }
  effortValue?: string
  advisorModel?: string
  tasks: Record<string, unknown>
  fileHistory: unknown
  attribution: unknown
  foregroundedTaskId?: string
  [key: string]: unknown
}

/**
 * 工具执行上下文 — 核心 context 对象
 * 源自 Tool.ts 的 ToolUseContext
 */
export type ToolUseContext = {
  options: {
    commands: unknown[]
    debug: boolean
    mainLoopModel: string
    tools: Tools
    verbose: boolean
    thinkingConfig: ThinkingConfig
    mcpClients: unknown[]
    mcpResources: Record<string, unknown[]>
    isNonInteractiveSession: boolean
    agentDefinitions: { activeAgents: AgentDefinition[]; allAgents: AgentDefinition[] }
    maxBudgetUsd?: number
    customSystemPrompt?: string
    appendSystemPrompt?: string
    refreshTools?: () => Tools
  }
  abortController: AbortController
  readFileState: FileStateCache
  getAppState(): AppState
  setAppState(f: (prev: AppState) => AppState): void
  messages: Message[]
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void
  setResponseLength: (f: (prev: number) => number) => void
  updateFileHistoryState: (updater: (prev: unknown) => unknown) => void
  updateAttributionState: (updater: (prev: unknown) => unknown) => void

  // 可选字段
  handleElicitation?: unknown
  setToolJSX?: unknown
  addNotification?: (notif: unknown) => void
  appendSystemMessage?: (msg: SystemMessage) => void
  agentId?: string
  agentType?: string
  queryTracking?: QueryChainTracking
  toolUseId?: string
  userModified?: boolean
  toolDecisions?: Map<string, { source: string; decision: string; timestamp: number }>
  contentReplacementState?: unknown
  setSDKStatus?: (status: unknown) => void
}

// ─── Query Types ─────────────────────────────────────────────────────────────

export type SystemPrompt = string[]

export type QuerySource =
  | 'sdk'
  | 'repl_main_thread'
  | 'compact'
  | 'session_memory'
  | `agent:${string}`

/**
 * QueryParams — query() 的入参
 * 源自 query.ts
 */
export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  taskBudget?: { total: number }
  deps?: QueryDeps
}

/**
 * QueryDeps — 依赖注入接口
 * 源自 query/deps.ts
 */
export type QueryDeps = {
  callModel: (params: {
    messages: Message[]
    systemPrompt: SystemPrompt
    thinkingConfig: ThinkingConfig
    tools: Tools
    signal: AbortSignal
    options: ModelCallOptions
  }) => AsyncGenerator<StreamEvent | AssistantMessage | SystemMessage, void>

  microcompact: (
    messages: Message[],
    toolUseContext: ToolUseContext,
    querySource: QuerySource,
  ) => Promise<{ messages: Message[]; compactionInfo?: unknown }>

  autocompact: (
    messages: Message[],
    toolUseContext: ToolUseContext,
    cacheSafeParams: unknown,
    querySource: QuerySource,
    tracking: unknown,
    snipTokensFreed: number,
  ) => Promise<{ compactionResult: CompactionResult | null; consecutiveFailures?: number }>

  uuid: () => string
}

export type ModelCallOptions = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  fastMode?: boolean
  toolChoice?: unknown
  isNonInteractiveSession?: boolean
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt?: boolean
  maxOutputTokensOverride?: number
  fetchOverride?: unknown
  mcpTools?: unknown[]
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  effortValue?: string
  advisorModel?: string
  skipCacheWrite?: boolean
  agentId?: string
  addNotification?: (notif: unknown) => void
  taskBudget?: { total: number; remaining?: number }
}

export type CompactionResult = {
  summaryMessages: Message[]
  attachments: Message[]
  hookResults: Message[]
  preCompactTokenCount: number
  postCompactTokenCount: number
  truePostCompactTokenCount: number
  compactionUsage?: Record<string, number>
}

/**
 * QueryConfig — 每次 query() 调用时快照的不可变配置
 * 源自 query/config.ts
 */
export type QueryConfig = {
  sessionId: string
  gates: {
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}

// ─── Loop State ──────────────────────────────────────────────────────────────

/**
 * Continue / Terminal — queryLoop 的循环控制
 * 源自 query/transitions.ts
 */
export type Continue =
  | { reason: 'next_turn' }
  | { reason: 'reactive_compact_retry' }
  | { reason: 'collapse_drain_retry'; committed: number }
  | { reason: 'max_output_tokens_recovery'; attempt: number }
  | { reason: 'max_output_tokens_escalate' }
  | { reason: 'stop_hook_blocking' }
  | { reason: 'token_budget_continuation' }

export type Terminal =
  | { reason: 'completed' }
  | { reason: 'aborted_streaming' }
  | { reason: 'aborted_tools' }
  | { reason: 'max_turns'; turnCount: number }
  | { reason: 'blocking_limit' }
  | { reason: 'prompt_too_long' }
  | { reason: 'model_error'; error?: unknown }
  | { reason: 'image_error' }
  | { reason: 'hook_stopped' }
  | { reason: 'stop_hook_prevented' }

/**
 * AutoCompact 跟踪状态
 */
export type AutoCompactTrackingState = {
  compacted: boolean
  turnId: string
  turnCounter: number
  consecutiveFailures: number
}

/**
 * 循环迭代间的可变状态
 * 源自 query.ts 的 State 类型
 */
export type LoopState = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined
}

// ─── QueryEngine Types ───────────────────────────────────────────────────────

/**
 * SDK 消息 — QueryEngine.submitMessage() 的 yield 类型
 * 简化自 entrypoints/agentSdkTypes.ts
 */
export type SDKMessage =
  | SDKSystemInitMessage
  | SDKAssistantMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKStreamEventMessage
  | SDKCompactBoundaryMessage

export type SDKSystemInitMessage = {
  type: 'system_init'
  tools: unknown[]
  model: string
  [key: string]: unknown
}

export type SDKAssistantMessage = {
  type: 'assistant'
  message: AssistantMessage['message']
  session_id: string
  [key: string]: unknown
}

export type SDKUserMessageReplay = {
  type: 'user'
  message: UserMessage['message']
  session_id: string
  isReplay?: boolean
  [key: string]: unknown
}

export type SDKResultMessage = {
  type: 'result'
  subtype: string
  is_error: boolean
  duration_ms: number
  num_turns: number
  result?: string
  stop_reason: string | null
  session_id: string
  total_cost_usd: number
  usage: Record<string, number>
  errors?: string[]
  [key: string]: unknown
}

export type SDKStreamEventMessage = {
  type: 'stream_event'
  event: StreamEvent['event']
  session_id: string
  [key: string]: unknown
}

export type SDKCompactBoundaryMessage = {
  type: 'system'
  subtype: 'compact_boundary'
  session_id: string
  [key: string]: unknown
}

/**
 * QueryEngineConfig
 * 源自 QueryEngine.ts
 */
export type QueryEngineConfig = {
  cwd: string
  tools: Tools
  commands: unknown[]
  mcpClients: unknown[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  initialMessages?: Message[]
  readFileCache: FileStateCache
  customSystemPrompt?: string
  appendSystemPrompt?: string
  userSpecifiedModel?: string
  fallbackModel?: string
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number
  taskBudget?: { total: number }
  jsonSchema?: Record<string, unknown>
  verbose?: boolean
  replayUserMessages?: boolean
  handleElicitation?: unknown
  includePartialMessages?: boolean
  setSDKStatus?: (status: unknown) => void
  abortController?: AbortController
}

// ─── Task Types (简化自 Task.ts) ─────────────────────────────────────────────

export type TaskType =
  | 'local_bash'
  | 'local_agent'
  | 'remote_agent'
  | 'in_process_teammate'
  | 'local_workflow'
  | 'monitor_mcp'
  | 'dream'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

export type TaskStateBase = {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
  toolUseId?: string
  startTime: number
  endTime?: number
  outputFile: string
  outputOffset: number
  notified: boolean
}

// ─── Token Budget Types ──────────────────────────────────────────────────────

export type BudgetTracker = {
  continuationCount: number
  lastDeltaTokens: number
  lastGlobalTurnTokens: number
  startedAt: number
}

export type TokenBudgetDecision =
  | {
      action: 'continue'
      nudgeMessage: string
      continuationCount: number
      pct: number
      turnTokens: number
      budget: number
    }
  | {
      action: 'stop'
      completionEvent: {
        continuationCount: number
        pct: number
        turnTokens: number
        budget: number
        diminishingReturns: boolean
        durationMs: number
      } | null
    }
