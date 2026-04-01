/**
 * 02-query-loop.ts — Agent 主循环
 *
 * 源自: src/query.ts
 *
 * 这是整个 Coding Agent 的心脏。
 * 一个 while(true) 迭代循环，每次迭代 = 一个 turn:
 *   call model (streaming) → collect tool_use blocks → execute tools → repeat
 *
 * 剥离: compaction (auto/micro/reactive/snip/context-collapse),
 *       analytics/telemetry, feature gates (bun:bundle),
 *       tool use summaries (haiku), skill/memory prefetch,
 *       queued commands, streaming tool executor,
 *       fallback model retry, dump-prompts
 * 保留: 完整的循环结构, 所有 7 种 continue 路径, abort 处理,
 *       max_output_tokens 恢复, stop hooks, token budget
 */

import type {
  Message,
  AssistantMessage,
  UserMessage,
  StreamEvent,
  RequestStartEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
  QueryParams,
  QueryDeps,
  QueryConfig,
  LoopState,
  Terminal,
  Continue,
  ToolUseContext,
  AutoCompactTrackingState,
  BudgetTracker,
  TokenBudgetDecision,
} from './00-types.js'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { runTools } from './04-tool-orchestration.js'
import { handleStopHooks } from './06-stop-hooks.js'
import { createBudgetTracker, checkTokenBudget } from './07-token-budget.js'

// ─── Helper: 创建消息 ────────────────────────────────────────────────────────

function createUserMessage(opts: {
  content: any
  isMeta?: boolean
  toolUseResult?: string
  sourceToolAssistantUUID?: string
}): UserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID() as any,
    message: { role: 'user', content: opts.content },
    isMeta: opts.isMeta,
    toolUseResult: opts.toolUseResult,
    sourceToolAssistantUUID: opts.sourceToolAssistantUUID as any,
    timestamp: Date.now(),
  }
}

function createAssistantAPIErrorMessage(opts: {
  content: string
  error?: string
}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID() as any,
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: [{ type: 'text', text: opts.content }],
      stop_reason: null,
    },
    isApiErrorMessage: true,
    apiError: opts.error,
    timestamp: Date.now(),
  }
}

function createUserInterruptionMessage(opts: { toolUse: boolean }): UserMessage {
  const content = opts.toolUse
    ? '[Request interrupted by user during tool execution]'
    : '[Request interrupted by user]'
  return createUserMessage({ content, isMeta: true })
}

// ─── Helper: 为缺少 tool_result 的 tool_use 生成错误响应 ─────────────────────

function* yieldMissingToolResultBlocks(
  assistantMessages: AssistantMessage[],
  errorMessage: string,
) {
  for (const assistantMessage of assistantMessages) {
    const toolUseBlocks = assistantMessage.message.content.filter(
      (content: any) => content.type === 'tool_use',
    )
    for (const toolUse of toolUseBlocks) {
      yield createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: errorMessage,
            is_error: true,
            tool_use_id: (toolUse as any).id,
          },
        ],
        toolUseResult: errorMessage,
        sourceToolAssistantUUID: assistantMessage.uuid as any,
      })
    }
  }
}

// ─── 默认 deps ───────────────────────────────────────────────────────────────

function defaultDeps(): Partial<QueryDeps> {
  return {
    uuid: () => crypto.randomUUID(),
    // callModel, microcompact, autocompact 需由调用者注入
  }
}

// ─── query() 入口 ────────────────────────────────────────────────────────────

/**
 * query() — 对外入口
 *
 * 包裹 queryLoop()，在完成后触发 command lifecycle 通知。
 */
export async function* query(
  params: QueryParams,
): AsyncGenerator<
  StreamEvent | RequestStartEvent | Message | TombstoneMessage | ToolUseSummaryMessage,
  Terminal
> {
  const terminal = yield* queryLoop(params)
  return terminal
}

// ─── MAX_OUTPUT_TOKENS 恢复限制 ──────────────────────────────────────────────

const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3
const ESCALATED_MAX_TOKENS = 64000

function isWithheldMaxOutputTokens(msg: Message | undefined): msg is AssistantMessage {
  return msg?.type === 'assistant' && (msg as AssistantMessage).apiError === 'max_output_tokens'
}

function isPromptTooLongMessage(msg: AssistantMessage): boolean {
  return msg.apiError === 'invalid_request' || msg.apiError === 'prompt_too_long'
}

// ─── queryLoop() — Agent 主循环 ──────────────────────────────────────────────

/**
 * queryLoop — 核心 while(true) 循环
 *
 * 每次迭代的阶段:
 * 1. 上下文预处理 (compact/snip — 此提取中简化为直接传入)
 * 2. 调用 model (streaming) → 收集 assistantMessages + toolUseBlocks
 * 3. 若无工具调用 → 恢复检查 → stop hooks → return
 * 4. 执行工具 → 收集 toolResults
 * 5. 追加 attachments
 * 6. maxTurns 检查
 * 7. state = { messages: [..., ...assistant, ...toolResults] }; continue
 *
 * 7 种 continue 路径:
 * - next_turn: 正常工具结果回传
 * - reactive_compact_retry: prompt-too-long 后重试
 * - collapse_drain_retry: context collapse 排空
 * - max_output_tokens_recovery: 输出截断多轮恢复
 * - max_output_tokens_escalate: 从 8k→64k 单轮重试
 * - stop_hook_blocking: stop hook 阻塞错误回传
 * - token_budget_continuation: token 预算未用完
 */
async function* queryLoop(
  params: QueryParams,
): AsyncGenerator<
  StreamEvent | RequestStartEvent | Message | TombstoneMessage | ToolUseSummaryMessage,
  Terminal
> {
  // ── 不可变参数 ──────────────────────────────────────────────────────────
  const {
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    fallbackModel,
    querySource,
    maxTurns,
  } = params
  const deps = params.deps ?? (defaultDeps() as QueryDeps)

  // ── 可变循环状态 ────────────────────────────────────────────────────────
  let state: LoopState = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    maxOutputTokensOverride: params.maxOutputTokensOverride,
    autoCompactTracking: undefined,
    stopHookActive: undefined,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
    pendingToolUseSummary: undefined,
    transition: undefined,
  }

  const budgetTracker = createBudgetTracker()

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN LOOP
  // ══════════════════════════════════════════════════════════════════════════
  while (true) {
    let { toolUseContext } = state
    const {
      messages,
      autoCompactTracking: tracking,
      maxOutputTokensRecoveryCount,
      hasAttemptedReactiveCompact,
      maxOutputTokensOverride,
      pendingToolUseSummary,
      stopHookActive,
      turnCount,
    } = state

    yield { type: 'stream_request_start' }

    // ── 更新 queryTracking ────────────────────────────────────────────────
    const queryTracking = toolUseContext.queryTracking
      ? {
          chainId: toolUseContext.queryTracking.chainId,
          depth: toolUseContext.queryTracking.depth + 1,
        }
      : {
          chainId: deps.uuid(),
          depth: 0,
        }

    toolUseContext = { ...toolUseContext, queryTracking }

    // ── 上下文预处理 (在完整版中包含 snip/microcompact/autocompact) ───────
    let messagesForQuery = [...messages]

    // 源码中此处会执行:
    // 1. applyToolResultBudget()  — 工具结果大小限制
    // 2. snipCompactIfNeeded()    — 裁剪旧消息
    // 3. microcompactMessages()   — 微压缩
    // 4. applyCollapsesIfNeeded() — context collapse
    // 5. autoCompactIfNeeded()    — 自动摘要压缩
    //
    // 此提取中简化: 直接使用原始 messages

    toolUseContext = { ...toolUseContext, messages: messagesForQuery }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1: 调用模型 (streaming)
    // ════════════════════════════════════════════════════════════════════════

    const assistantMessages: AssistantMessage[] = []
    const toolResults: (UserMessage | Message)[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false
    let lastStopReason: string | null = null

    const appState = toolUseContext.getAppState()
    const currentModel = toolUseContext.options.mainLoopModel

    try {
      for await (const message of deps.callModel({
        messages: messagesForQuery,
        systemPrompt,
        thinkingConfig: toolUseContext.options.thinkingConfig,
        tools: toolUseContext.options.tools,
        signal: toolUseContext.abortController.signal,
        options: {
          async getToolPermissionContext() {
            return appState.toolPermissionContext
          },
          model: currentModel,
          toolChoice: undefined,
          isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
          fallbackModel,
          querySource,
          agents: toolUseContext.options.agentDefinitions.activeAgents,
          maxOutputTokensOverride,
          queryTracking,
          agentId: toolUseContext.agentId,
        },
      })) {
        // ── 流式消息处理 ────────────────────────────────────────────────
        let withheld = false

        // 扣住 max_output_tokens 错误直到确认是否可恢复
        if (isWithheldMaxOutputTokens(message as any)) {
          withheld = true
        }

        if (!withheld) {
          yield message
        }

        if (message.type === 'assistant') {
          const assistantMsg = message as AssistantMessage
          assistantMessages.push(assistantMsg)

          if (assistantMsg.message.stop_reason != null) {
            lastStopReason = assistantMsg.message.stop_reason
          }

          // 收集 tool_use blocks
          const msgToolUseBlocks = assistantMsg.message.content.filter(
            (content: any) => content.type === 'tool_use',
          ) as ToolUseBlock[]

          if (msgToolUseBlocks.length > 0) {
            toolUseBlocks.push(...msgToolUseBlocks)
            needsFollowUp = true
          }
        }

        // 从 stream_event 中捕获 stop_reason
        if ((message as any).type === 'stream_event') {
          const evt = (message as any).event
          if (evt?.type === 'message_delta' && evt.delta?.stop_reason != null) {
            lastStopReason = evt.delta.stop_reason
          }
        }
      }
    } catch (error) {
      // ── 模型调用错误处理 ──────────────────────────────────────────────
      const errMsg = error instanceof Error ? error.message : String(error)
      yield* yieldMissingToolResultBlocks(assistantMessages, errMsg)
      yield createAssistantAPIErrorMessage({ content: errMsg })
      return { reason: 'model_error', error }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1.5: Abort 检查 (流式结束后)
    // ════════════════════════════════════════════════════════════════════════

    if (toolUseContext.abortController.signal.aborted) {
      yield* yieldMissingToolResultBlocks(assistantMessages, 'Interrupted by user')
      if (toolUseContext.abortController.signal.reason !== 'interrupt') {
        yield createUserInterruptionMessage({ toolUse: false })
      }
      return { reason: 'aborted_streaming' }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2: 无工具调用 → 恢复检查 + stop hooks → 结束
    // ════════════════════════════════════════════════════════════════════════

    if (!needsFollowUp) {
      const lastMessage = assistantMessages.at(-1)

      // ── max_output_tokens 恢复 ──────────────────────────────────────────
      if (isWithheldMaxOutputTokens(lastMessage)) {
        // 升级重试: 如果用 8k 默认限制命中，以 64k 重试同一请求
        if (maxOutputTokensOverride === undefined) {
          state = {
            ...state,
            messages: messagesForQuery,
            toolUseContext,
            maxOutputTokensOverride: ESCALATED_MAX_TOKENS,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            transition: { reason: 'max_output_tokens_escalate' },
          }
          continue
        }

        // 多轮恢复: 注入"继续"指令
        if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
          const recoveryMessage = createUserMessage({
            content:
              'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
              'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
            isMeta: true,
          })
          state = {
            ...state,
            messages: [...messagesForQuery, ...assistantMessages, recoveryMessage],
            toolUseContext,
            maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            transition: {
              reason: 'max_output_tokens_recovery',
              attempt: maxOutputTokensRecoveryCount + 1,
            },
          }
          continue
        }

        // 恢复耗尽 — 暴露被扣住的错误
        yield lastMessage
      }

      // ── API 错误 → 跳过 stop hooks ──────────────────────────────────────
      if (lastMessage?.isApiErrorMessage) {
        return { reason: 'completed' }
      }

      // ── Stop Hooks ──────────────────────────────────────────────────────
      const stopHookResult = yield* handleStopHooks(
        messagesForQuery,
        assistantMessages,
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        querySource,
        stopHookActive,
      )

      if (stopHookResult.preventContinuation) {
        return { reason: 'stop_hook_prevented' }
      }

      if (stopHookResult.blockingErrors.length > 0) {
        state = {
          ...state,
          messages: [
            ...messagesForQuery,
            ...assistantMessages,
            ...stopHookResult.blockingErrors,
          ],
          toolUseContext,
          maxOutputTokensRecoveryCount: 0,
          hasAttemptedReactiveCompact,
          maxOutputTokensOverride: undefined,
          pendingToolUseSummary: undefined,
          stopHookActive: true,
          transition: { reason: 'stop_hook_blocking' },
        }
        continue
      }

      // ── Token Budget 检查 ───────────────────────────────────────────────
      const budgetDecision = checkTokenBudget(
        budgetTracker,
        toolUseContext.agentId,
        null, // getCurrentTurnTokenBudget()
        0,    // getTurnOutputTokens()
      )

      if (budgetDecision.action === 'continue') {
        state = {
          ...state,
          messages: [
            ...messagesForQuery,
            ...assistantMessages,
            createUserMessage({
              content: (budgetDecision as any).nudgeMessage,
              isMeta: true,
            }),
          ],
          toolUseContext,
          maxOutputTokensRecoveryCount: 0,
          hasAttemptedReactiveCompact: false,
          maxOutputTokensOverride: undefined,
          pendingToolUseSummary: undefined,
          stopHookActive: undefined,
          transition: { reason: 'token_budget_continuation' },
        }
        continue
      }

      // ── 完成 ────────────────────────────────────────────────────────────
      return { reason: 'completed' }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3: 执行工具
    // ════════════════════════════════════════════════════════════════════════

    let shouldPreventContinuation = false
    let updatedToolUseContext = toolUseContext

    for await (const update of runTools(
      toolUseBlocks,
      assistantMessages,
      canUseTool,
      toolUseContext,
    )) {
      if (update.message) {
        yield update.message

        if (
          update.message.type === 'attachment' &&
          (update.message as any).attachment?.type === 'hook_stopped_continuation'
        ) {
          shouldPreventContinuation = true
        }

        toolResults.push(update.message)
      }
      if (update.newContext) {
        updatedToolUseContext = { ...update.newContext, queryTracking }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3.5: 工具执行期间的 abort 检查
    // ════════════════════════════════════════════════════════════════════════

    if (toolUseContext.abortController.signal.aborted) {
      if (toolUseContext.abortController.signal.reason !== 'interrupt') {
        yield createUserInterruptionMessage({ toolUse: true })
      }
      const nextTurnCountOnAbort = turnCount + 1
      if (maxTurns && nextTurnCountOnAbort > maxTurns) {
        yield {
          type: 'attachment',
          uuid: crypto.randomUUID() as any,
          attachment: { type: 'max_turns_reached', maxTurns, turnCount: nextTurnCountOnAbort },
          timestamp: Date.now(),
        } as any
      }
      return { reason: 'aborted_tools' }
    }

    // Hook 阻止继续
    if (shouldPreventContinuation) {
      return { reason: 'hook_stopped' }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 4: Attachments (通知、memory、skill discovery)
    // ════════════════════════════════════════════════════════════════════════

    // 源码中此处会:
    // 1. 获取 queued commands (task notifications, user prompts)
    // 2. getAttachmentMessages() — file change diffs, memory, skill discovery
    // 3. pendingMemoryPrefetch consume
    // 4. pendingSkillPrefetch consume
    //
    // 此提取中简化: 跳过 attachment 注入

    // 刷新工具列表 (MCP servers 可能在 turn 间连接)
    if (updatedToolUseContext.options.refreshTools) {
      const refreshedTools = updatedToolUseContext.options.refreshTools()
      if (refreshedTools !== updatedToolUseContext.options.tools) {
        updatedToolUseContext = {
          ...updatedToolUseContext,
          options: { ...updatedToolUseContext.options, tools: refreshedTools },
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 5: maxTurns 检查 + 继续下一轮
    // ════════════════════════════════════════════════════════════════════════

    const nextTurnCount = turnCount + 1

    if (maxTurns && nextTurnCount > maxTurns) {
      yield {
        type: 'attachment',
        uuid: crypto.randomUUID() as any,
        attachment: { type: 'max_turns_reached', maxTurns, turnCount: nextTurnCount },
        timestamp: Date.now(),
      } as any
      return { reason: 'max_turns', turnCount: nextTurnCount }
    }

    // ── continue → 下一轮 ─────────────────────────────────────────────────
    state = {
      messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
      toolUseContext: { ...updatedToolUseContext, queryTracking },
      autoCompactTracking: tracking,
      turnCount: nextTurnCount,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: undefined,
      maxOutputTokensOverride: undefined,
      stopHookActive,
      transition: { reason: 'next_turn' },
    }
  } // while (true)
}
