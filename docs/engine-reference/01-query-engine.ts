/**
 * 01-query-engine.ts — 会话管理层
 *
 * 源自: src/QueryEngine.ts
 *
 * QueryEngine 拥有一个会话的完整生命周期。
 * 每次 submitMessage() 调用对应一个新 turn，
 * 状态 (messages, fileCache, usage) 跨 turn 持久。
 *
 * 剥离: session 持久化(recordTranscript), feature gates, analytics,
 *       structured output enforcement, snipReplay, USD budget checks,
 *       IDE-specific logic
 */

import { randomUUID } from 'crypto'
import type {
  Message,
  AssistantMessage,
  SDKMessage,
  SDKResultMessage,
  QueryEngineConfig,
  ThinkingConfig,
  FileStateCache,
  CanUseToolFn,
  PermissionResult,
  ToolUseContext,
  AgentDefinition,
} from './00-types.js'
import { query } from './02-query-loop.js'

// ─── Usage Tracking ──────────────────────────────────────────────────────────

type NonNullableUsage = Record<string, number>
const EMPTY_USAGE: NonNullableUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

function updateUsage(
  current: NonNullableUsage,
  update?: Record<string, number>,
): NonNullableUsage {
  if (!update) return current
  return {
    input_tokens: update.input_tokens ?? current.input_tokens,
    output_tokens: update.output_tokens ?? current.output_tokens,
    cache_creation_input_tokens:
      update.cache_creation_input_tokens ?? current.cache_creation_input_tokens,
    cache_read_input_tokens:
      update.cache_read_input_tokens ?? current.cache_read_input_tokens,
  }
}

function accumulateUsage(
  total: NonNullableUsage,
  current: NonNullableUsage,
): NonNullableUsage {
  return {
    input_tokens: total.input_tokens + current.input_tokens,
    output_tokens: total.output_tokens + current.output_tokens,
    cache_creation_input_tokens:
      total.cache_creation_input_tokens + current.cache_creation_input_tokens,
    cache_read_input_tokens:
      total.cache_read_input_tokens + current.cache_read_input_tokens,
  }
}

// ─── QueryEngine ─────────────────────────────────────────────────────────────

/**
 * QueryEngine 是会话管理的核心。
 *
 * 一个 QueryEngine 对应一个会话。每次 submitMessage() 调用启动一个新 turn。
 * 消息历史、文件缓存、usage 跨 turn 保持。
 *
 * 这是 headless/SDK 路径和 REPL 的统一入口。
 */
export class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]
  private abortController: AbortController
  private totalUsage: NonNullableUsage
  private readFileState: FileStateCache

  constructor(config: QueryEngineConfig) {
    this.config = config
    this.mutableMessages = config.initialMessages ?? []
    this.abortController = config.abortController ?? new AbortController()
    this.totalUsage = EMPTY_USAGE
    this.readFileState = config.readFileCache
  }

  /**
   * submitMessage — 一个 turn 的完整生命周期
   *
   * 核心流程:
   * 1. 构建 system prompt
   * 2. 处理用户输入 (slash commands, processUserInput)
   * 3. 调用 query() generator — 对每条 message 按 type 分发
   * 4. 累计 usage, 检查 budget/limits
   * 5. yield 最终 result
   */
  async *submitMessage(
    prompt: string,
    options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<SDKMessage, void, unknown> {
    const {
      cwd,
      tools,
      mcpClients,
      verbose = false,
      thinkingConfig,
      maxTurns,
      maxBudgetUsd,
      taskBudget,
      canUseTool,
      customSystemPrompt,
      appendSystemPrompt,
      userSpecifiedModel,
      fallbackModel,
      getAppState,
      setAppState,
      agents = [],
    } = this.config

    const startTime = Date.now()
    const sessionId = randomUUID()

    // ── 1. 构建 system prompt ──────────────────────────────────────────────
    const systemPrompt = [
      ...(customSystemPrompt ? [customSystemPrompt] : [/* 默认 system prompt */]),
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ]

    // ── 2. 构建用户消息 ────────────────────────────────────────────────────
    const userMessage: Message = {
      type: 'user',
      uuid: (options?.uuid ?? randomUUID()) as any,
      message: { role: 'user', content: prompt },
      isMeta: options?.isMeta,
      timestamp: Date.now(),
    }
    this.mutableMessages.push(userMessage)

    const initialThinkingConfig: ThinkingConfig = thinkingConfig ?? { type: 'adaptive' }

    // ── 3. 构建 ToolUseContext ─────────────────────────────────────────────
    const processUserInputContext: ToolUseContext = {
      messages: this.mutableMessages,
      options: {
        commands: [],
        debug: false,
        tools,
        verbose,
        mainLoopModel: userSpecifiedModel ?? 'claude-sonnet-4-6',
        thinkingConfig: initialThinkingConfig,
        mcpClients: mcpClients as any[],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: agents, allAgents: [] },
        maxBudgetUsd,
      },
      abortController: this.abortController,
      readFileState: this.readFileState,
      getAppState,
      setAppState,
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    }

    // ── 4. 进入 query loop ─────────────────────────────────────────────────
    let currentMessageUsage: NonNullableUsage = EMPTY_USAGE
    let turnCount = 1
    let lastStopReason: string | null = null

    for await (const message of query({
      messages: [...this.mutableMessages],
      systemPrompt,
      userContext: {},
      systemContext: {},
      canUseTool,
      toolUseContext: processUserInputContext,
      fallbackModel,
      querySource: 'sdk',
      maxTurns,
      taskBudget,
    })) {
      // ── 分发消息 ──────────────────────────────────────────────────────
      if (message.type === 'user') {
        turnCount++
      }

      switch (message.type) {
        case 'assistant':
          if ((message as AssistantMessage).message.stop_reason != null) {
            lastStopReason = (message as AssistantMessage).message.stop_reason
          }
          this.mutableMessages.push(message as Message)
          yield {
            type: 'assistant',
            message: (message as AssistantMessage).message,
            session_id: sessionId,
          }
          break

        case 'user':
          this.mutableMessages.push(message as Message)
          break

        case 'stream_event': {
          const evt = (message as any).event
          if (evt.type === 'message_start') {
            currentMessageUsage = EMPTY_USAGE
            currentMessageUsage = updateUsage(currentMessageUsage, evt.message?.usage)
          }
          if (evt.type === 'message_delta') {
            currentMessageUsage = updateUsage(currentMessageUsage, evt.usage)
            if (evt.delta?.stop_reason != null) {
              lastStopReason = evt.delta.stop_reason
            }
          }
          if (evt.type === 'message_stop') {
            this.totalUsage = accumulateUsage(this.totalUsage, currentMessageUsage)
          }
          break
        }

        case 'attachment': {
          const att = (message as any).attachment
          // maxTurns 达到
          if (att?.type === 'max_turns_reached') {
            yield {
              type: 'result',
              subtype: 'error_max_turns',
              is_error: true,
              duration_ms: Date.now() - startTime,
              num_turns: att.turnCount,
              stop_reason: lastStopReason,
              session_id: sessionId,
              total_cost_usd: 0,
              usage: this.totalUsage,
              errors: [`Reached maximum number of turns (${att.maxTurns})`],
            } as SDKResultMessage
            return
          }
          break
        }

        case 'system': {
          const sys = message as any
          if (sys.subtype === 'compact_boundary') {
            // GC 旧消息
            const idx = this.mutableMessages.length - 1
            if (idx > 0) {
              this.mutableMessages.splice(0, idx)
            }
          }
          break
        }

        default:
          break
      }
    }

    // ── 5. yield 最终 result ───────────────────────────────────────────────
    const lastAssistant = this.mutableMessages.findLast(m => m.type === 'assistant') as AssistantMessage | undefined
    let textResult = ''
    if (lastAssistant) {
      const lastContent = lastAssistant.message.content.at(-1)
      if (lastContent && 'text' in lastContent && typeof (lastContent as any).text === 'string') {
        textResult = (lastContent as any).text
      }
    }

    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: Date.now() - startTime,
      num_turns: turnCount,
      result: textResult,
      stop_reason: lastStopReason,
      session_id: sessionId,
      total_cost_usd: 0,
      usage: this.totalUsage,
    } as SDKResultMessage
  }

  interrupt(): void {
    this.abortController.abort()
  }

  getMessages(): readonly Message[] {
    return this.mutableMessages
  }
}

// ─── ask() 便捷函数 ──────────────────────────────────────────────────────────

/**
 * 一次性 prompt → response 的便捷包装。
 * 源自 QueryEngine.ts 底部的 ask() 函数。
 */
export async function* ask(params: {
  prompt: string
  cwd: string
  tools: any
  canUseTool: CanUseToolFn
  getAppState: () => any
  setAppState: (f: (prev: any) => any) => void
  [key: string]: unknown
}): AsyncGenerator<SDKMessage, void, unknown> {
  const engine = new QueryEngine({
    cwd: params.cwd,
    tools: params.tools,
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: params.canUseTool,
    getAppState: params.getAppState,
    setAppState: params.setAppState,
    readFileCache: new Map(),
    ...params,
  })
  yield* engine.submitMessage(params.prompt)
}
