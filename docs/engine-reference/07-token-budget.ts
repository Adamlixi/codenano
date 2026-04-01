/**
 * 07-token-budget.ts — Token 预算控制
 *
 * 源自: src/query/tokenBudget.ts
 *
 * 当 Agent 配置了 token budget (如 +500k auto-continue) 时，
 * 在模型响应的 end_turn 之后检查是否应该继续。
 *
 * 完整保留: 此文件逻辑简洁，几乎全部保留。
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * 完成阈值 — 当 token 使用达到预算的 90% 时停止
 */
const COMPLETION_THRESHOLD = 0.9

/**
 * 衰减阈值 — 如果连续 3 次 continuation 且增量 < 500 tokens，
 * 认为模型进入了"衰减回报"阶段，强制停止
 */
const DIMINISHING_THRESHOLD = 500

// ─── Types ──────────────────────────────────────────────────────────────────

/** 预算追踪器状态 */
export type BudgetTracker = {
  /** 已继续的次数 */
  continuationCount: number
  /** 上次检查时的增量 tokens */
  lastDeltaTokens: number
  /** 上次检查时的全局 turn tokens */
  lastGlobalTurnTokens: number
  /** 开始时间 (用于 analytics) */
  startedAt: number
}

/** 继续决策 */
type ContinueDecision = {
  action: 'continue'
  /** 注入给模型的提示消息 (告知已使用 X% 预算) */
  nudgeMessage: string
  continuationCount: number
  pct: number
  turnTokens: number
  budget: number
}

/** 停止决策 */
type StopDecision = {
  action: 'stop'
  /** 完成事件 (用于 analytics, null 表示首次检查就不需要继续) */
  completionEvent: {
    continuationCount: number
    pct: number
    turnTokens: number
    budget: number
    diminishingReturns: boolean
    durationMs: number
  } | null
}

/** Token 预算决策 */
export type TokenBudgetDecision = ContinueDecision | StopDecision

// ─── 创建追踪器 ────────────────────────────────────────────────────────────

export function createBudgetTracker(): BudgetTracker {
  return {
    continuationCount: 0,
    lastDeltaTokens: 0,
    lastGlobalTurnTokens: 0,
    startedAt: Date.now(),
  }
}

// ─── 检查预算 ──────────────────────────────────────────────────────────────

/**
 * checkTokenBudget — 检查是否应继续
 *
 * 源自 src/query/tokenBudget.ts:checkTokenBudget()
 *
 * 调用时机:
 * - queryLoop 中模型响应 end_turn 且无 tool_use
 * - stop hooks 通过后
 * - 仅当配置了 token budget 时
 *
 * 决策逻辑:
 *
 * 1. 如果是 subagent 或无 budget → stop (null event)
 *    子 agent 不使用 token budget — 由父 agent 控制
 *
 * 2. 计算使用百分比: pct = turnTokens / budget * 100
 *
 * 3. 衰减检测:
 *    - 至少 3 次 continuation
 *    - 最近两次增量都 < DIMINISHING_THRESHOLD (500)
 *    → 模型在"空转"，强制停止
 *
 * 4. 如果 !衰减 且 使用 < 90% budget → continue
 *    - 注入 nudge 消息告知模型: "你已使用 X% 预算，请继续"
 *    - 更新 tracker 状态
 *
 * 5. 否则 → stop
 *    - 如果有过 continuation → 返回 completionEvent (analytics)
 *    - 否则 → null event (首次就停止)
 *
 * @param tracker - 追踪器状态 (跨 continuation 持久)
 * @param agentId - 如果是 subagent 则为其 ID
 * @param budget - token 预算 (null = 无预算)
 * @param globalTurnTokens - 本 turn 已使用的 output tokens
 */
export function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  budget: number | null,
  globalTurnTokens: number,
): TokenBudgetDecision {
  // Subagents 和无 budget 的情况直接停止
  if (agentId || budget === null || budget <= 0) {
    return { action: 'stop', completionEvent: null }
  }

  const turnTokens = globalTurnTokens
  const pct = Math.round((turnTokens / budget) * 100)
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens

  // 衰减检测: 连续 3+ 次且增量都很小
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD

  // 继续条件: 非衰减 且 未达阈值
  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount++
    tracker.lastDeltaTokens = deltaSinceLastCheck
    tracker.lastGlobalTurnTokens = globalTurnTokens
    return {
      action: 'continue',
      nudgeMessage: getBudgetContinuationMessage(pct, turnTokens, budget),
      continuationCount: tracker.continuationCount,
      pct,
      turnTokens,
      budget,
    }
  }

  // 停止
  if (isDiminishing || tracker.continuationCount > 0) {
    return {
      action: 'stop',
      completionEvent: {
        continuationCount: tracker.continuationCount,
        pct,
        turnTokens,
        budget,
        diminishingReturns: isDiminishing,
        durationMs: Date.now() - tracker.startedAt,
      },
    }
  }

  // 首次检查就不需要继续
  return { action: 'stop', completionEvent: null }
}

// ─── 预算提示消息 ──────────────────────────────────────────────────────────

/**
 * getBudgetContinuationMessage — 生成注入给模型的 nudge 消息
 *
 * 源自 src/utils/tokenBudget.ts:getBudgetContinuationMessage()
 *
 * 告知模型当前已使用多少 budget，鼓励继续工作
 */
function getBudgetContinuationMessage(
  pct: number,
  turnTokens: number,
  budget: number,
): string {
  return (
    `You have used approximately ${pct}% of your output token budget ` +
    `(${turnTokens.toLocaleString()} of ${budget.toLocaleString()} tokens). ` +
    `Please continue working on the task. ` +
    `If you believe you have completed the task, you may stop.`
  )
}
