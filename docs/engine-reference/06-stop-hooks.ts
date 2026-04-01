/**
 * 06-stop-hooks.ts — Stop hooks 处理
 *
 * 源自: src/query/stopHooks.ts
 *
 * 当 Agent 完成一轮响应 (无工具调用) 时，在确认 "completed" 之前
 * 运行 Stop hooks。hooks 可以阻塞继续、产生错误或阻止完成。
 *
 * 剥离: analytics/telemetry, feature gates (bun:bundle),
 *       template job classification, prompt suggestion,
 *       memory extraction, auto-dream, computer use cleanup,
 *       keyboard shortcut display, MCP auto-unhide
 * 保留: 完整的 hook 执行流程, 错误收集, teammate hooks,
 *       preventContinuation 逻辑
 */

import type {
  Message,
  AssistantMessage,
  StreamEvent,
  ToolUseContext,
} from './00-types.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Stop hook 的最终结果 */
export type StopHookResult = {
  /** 阻塞性错误 — 需要回传给模型修复 */
  blockingErrors: Message[]
  /** 是否阻止 agent 继续 */
  preventContinuation: boolean
}

/** Hook 进度信息 */
type StopHookInfo = {
  command: string
  promptText?: string
  durationMs?: number
}

// ─── 核心处理 ──────────────────────────────────────────────────────────────

/**
 * handleStopHooks — Stop hooks 主处理器
 *
 * 源自 src/query/stopHooks.ts:handleStopHooks()
 *
 * 调用时机:
 * - queryLoop 中模型响应完成且无 tool_use blocks
 * - 即 "模型认为任务完成了" 的时刻
 *
 * 完整流程:
 *
 * 1. 保存 cache-safe params (用于 /btw 命令和 SDK control_request)
 *
 * 2. Template job classification (如果在 job 模式下)
 *    - 分类当前状态 → 写入 state.json
 *
 * 3. 后台 fire-and-forget 任务 (非 bare 模式):
 *    a. executePromptSuggestion — 建议下一步 prompt
 *    b. executeExtractMemories — 提取记忆 (如果启用)
 *    c. executeAutoDream — 自动做梦 (后台)
 *
 * 4. Computer use cleanup (如果启用)
 *    - 释放 CU lock, auto-unhide
 *
 * 5. 执行 Stop hooks (executeStopHooks)
 *    - 并行运行所有配置的 Stop hooks
 *    - 收集进度消息、错误、阻塞错误
 *    - 检查 preventContinuation
 *    - 检查 abort
 *
 * 6. 创建 hook summary 消息 (如果有 hooks 运行)
 *
 * 7. Teammate hooks (如果是 teammate):
 *    a. TaskCompleted hooks — 对 in-progress tasks
 *    b. TeammateIdle hooks — teammate 空闲通知
 *
 * 返回值:
 * - blockingErrors: 需要回传给模型的错误消息
 *   → queryLoop 将这些作为 user 消息注入，触发模型修复
 * - preventContinuation: 如果 true，queryLoop 直接返回 'hook_stopped'
 *
 * @param messagesForQuery - 当前 query 的消息历史
 * @param assistantMessages - 本轮的 assistant 消息
 * @param systemPrompt - 系统提示
 * @param userContext - 用户上下文
 * @param systemContext - 系统上下文
 * @param toolUseContext - 工具使用上下文
 * @param querySource - 查询来源 (repl_main_thread, sdk, agent:xxx, etc.)
 * @param stopHookActive - 是否已在 stop hook 处理中 (防止递归)
 */
export async function* handleStopHooks(
  messagesForQuery: Message[],
  assistantMessages: AssistantMessage[],
  systemPrompt: string[],
  userContext: { [k: string]: string },
  systemContext: { [k: string]: string },
  toolUseContext: ToolUseContext,
  querySource: string,
  stopHookActive?: boolean,
): AsyncGenerator<StreamEvent | Message, StopHookResult> {
  // ── 1-4. 后台任务 (简化 — 生产版本有 feature gate 控制) ──────────────
  // saveCacheSafeParams(createCacheSafeParams(stopHookContext))
  // void executePromptSuggestion(stopHookContext)
  // void extractMemoriesModule.executeExtractMemories(stopHookContext)
  // void executeAutoDream(stopHookContext)

  // ── 5. 执行 Stop hooks ──────────────────────────────────────────────
  try {
    const blockingErrors: Message[] = []
    let preventedContinuation = false

    // 生产版本:
    // const generator = executeStopHooks(
    //   permissionMode,
    //   toolUseContext.abortController.signal,
    //   undefined,
    //   stopHookActive ?? false,
    //   toolUseContext.agentId,
    //   toolUseContext,
    //   [...messagesForQuery, ...assistantMessages],
    //   toolUseContext.agentType,
    // )
    //
    // for await (const result of generator) {
    //   if (result.message) yield result.message
    //   if (result.blockingError) {
    //     const userMessage = createUserMessage({
    //       content: getStopHookMessage(result.blockingError),
    //       isMeta: true,
    //     })
    //     blockingErrors.push(userMessage)
    //     yield userMessage
    //   }
    //   if (result.preventContinuation) {
    //     preventedContinuation = true
    //     stopReason = result.stopReason || 'Stop hook prevented continuation'
    //   }
    //   if (toolUseContext.abortController.signal.aborted) {
    //     yield createUserInterruptionMessage({ toolUse: false })
    //     return { blockingErrors: [], preventContinuation: true }
    //   }
    // }

    // ── 检查 abort ─────────────────────────────────────────────────
    if (toolUseContext.abortController.signal.aborted) {
      return { blockingErrors: [], preventContinuation: true }
    }

    if (preventedContinuation) {
      return { blockingErrors: [], preventContinuation: true }
    }

    if (blockingErrors.length > 0) {
      return { blockingErrors, preventContinuation: false }
    }

    // ── 7. Teammate hooks ─────────────────────────────────────────
    // 生产版本:
    // if (isTeammate()) {
    //   // a. TaskCompleted hooks — 对每个 in-progress task
    //   for (const task of inProgressTasks) {
    //     for await (const result of executeTaskCompletedHooks(...)) {
    //       // 收集 blockingErrors, preventContinuation
    //     }
    //   }
    //   // b. TeammateIdle hooks
    //   for await (const result of executeTeammateIdleHooks(...)) {
    //     // 收集 blockingErrors, preventContinuation
    //   }
    // }

    return { blockingErrors: [], preventContinuation: false }
  } catch (error) {
    // Hook 执行错误不应阻塞 Agent — 静默处理
    // 生产版本: yield createSystemMessage(`Stop hook failed: ${errorMessage(error)}`, 'warning')
    return { blockingErrors: [], preventContinuation: false }
  }
}
