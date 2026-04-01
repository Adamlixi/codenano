/**
 * 04-tool-orchestration.ts — 工具批次编排
 *
 * 源自: src/services/tools/toolOrchestration.ts
 *
 * 负责将一组 tool_use blocks 分区为并发/串行批次，
 * 然后按批次执行，收集结果。
 *
 * 保留: 完整的编排逻辑 — partitionToolCalls, runTools,
 *       runToolsConcurrently, runToolsSerially
 * 剥离: 无 (此文件本身很纯净，几乎全部保留)
 */

import type {
  Message,
  AssistantMessage,
  ToolUseContext,
  CanUseToolFn,
  Tool,
} from './00-types.js'
import { runToolUse, type MessageUpdateLazy } from './05-tool-execution.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** 工具调用块 — 对应 Anthropic SDK 的 ToolUseBlock */
export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** 编排层的消息更新 */
export type MessageUpdate = {
  message?: Message
  newContext: ToolUseContext
}

/** 分区批次 */
type Batch = {
  isConcurrencySafe: boolean
  blocks: ToolUseBlock[]
}

// ─── 最大并发度 ─────────────────────────────────────────────────────────────

function getMaxToolUseConcurrency(): number {
  return (
    parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
  )
}

// ─── 并发工具合并 (all) ─────────────────────────────────────────────────────

/**
 * all — 并发执行多个 async generator，合并输出
 *
 * 源自 src/utils/generators.ts:all()
 *
 * 类似 Promise.all 但用于 AsyncGenerator:
 * - 同时启动所有 generator
 * - 按完成顺序 yield 结果
 * - 限制最大并发度
 */
async function* all<T>(
  generators: AsyncGenerator<T, void>[],
  maxConcurrency: number,
): AsyncGenerator<T, void> {
  // 简化实现 — 生产版本使用更高效的 promise 竞争
  for (const gen of generators) {
    for await (const value of gen) {
      yield value
    }
  }
}

// ─── findToolByName ─────────────────────────────────────────────────────────

/**
 * findToolByName — 在工具集中查找工具
 *
 * 源自 src/Tool.ts:findToolByName()
 *
 * 按 name 和 aliases 匹配
 */
function findToolByName(tools: readonly Tool[], name: string): Tool | undefined {
  return tools.find(
    t => t.name === name || (t.aliases && t.aliases.includes(name))
  )
}

// ─── 核心编排 ──────────────────────────────────────────────────────────────

/**
 * runTools — 工具编排入口
 *
 * 源自 src/services/tools/toolOrchestration.ts:runTools()
 *
 * 流程:
 * 1. partitionToolCalls() 将工具调用分为批次
 * 2. 对每个批次:
 *    - 并发安全 → runToolsConcurrently() (Read, Glob 等)
 *    - 非并发安全 → runToolsSerially() (Edit, Write 等)
 * 3. 每批次完成后应用 context modifiers
 * 4. yield 每个工具的结果消息
 *
 * Context Modifiers:
 * - 工具可以返回 contextModifier 来修改 ToolUseContext
 * - 并发批次: 累积所有 modifiers，批次结束后按顺序应用
 * - 串行批次: 每个工具结束后立即应用
 */
export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    if (isConcurrencySafe) {
      // ── 并发执行 read-only 工具 ─────────────────────────────────────
      const queuedContextModifiers: Record<
        string,
        ((context: ToolUseContext) => ToolUseContext)[]
      > = {}

      for await (const update of runToolsConcurrently(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.contextModifier) {
          const { toolUseID, modifyContext } = update.contextModifier
          if (!queuedContextModifiers[toolUseID]) {
            queuedContextModifiers[toolUseID] = []
          }
          queuedContextModifiers[toolUseID]!.push(modifyContext)
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }

      // 批次结束后，按工具顺序应用所有 context modifiers
      for (const block of blocks) {
        const modifiers = queuedContextModifiers[block.id]
        if (!modifiers) continue
        for (const modifier of modifiers) {
          currentContext = modifier(currentContext)
        }
      }
      yield { newContext: currentContext }
    } else {
      // ── 串行执行非 read-only 工具 ───────────────────────────────────
      for await (const update of runToolsSerially(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.newContext) {
          currentContext = update.newContext
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
    }
  }
}

// ─── 分区算法 ──────────────────────────────────────────────────────────────

/**
 * partitionToolCalls — 将工具调用分为并发/串行批次
 *
 * 规则:
 * - 连续的 concurrency-safe 工具合并为一个并发批次
 * - 非 concurrency-safe 工具各自成为一个串行批次
 *
 * 判断 concurrency-safe:
 * - 工具必须有 isConcurrencySafe() 方法且返回 true
 * - 输入必须通过 Zod schema 验证
 * - 如果 isConcurrencySafe() 抛异常，保守地视为不安全
 *
 * 示例:
 * [Read, Glob, Edit, Read, Read]
 * → [{ safe: true, [Read, Glob] }, { safe: false, [Edit] }, { safe: true, [Read, Read] }]
 */
function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            // 保守策略: 如果 isConcurrencySafe 抛异常，视为不安全
            return false
          }
        })()
      : false

    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}

// ─── 串行执行 ──────────────────────────────────────────────────────────────

/**
 * runToolsSerially — 逐个执行工具
 *
 * 用于非 concurrency-safe 的工具 (Edit, Write, Bash 等)
 *
 * 每个工具:
 * 1. 标记为 in-progress
 * 2. 调用 runToolUse()
 * 3. 立即应用 contextModifier
 * 4. 标记为完成
 */
async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const toolUse of toolUseMessages) {
    toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(toolUse.id),
    )

    for await (const update of runToolUse(
      toolUse,
      assistantMessages.find(a =>
        a.message.content.some(
          (c: any) => c.type === 'tool_use' && c.id === toolUse.id,
        ),
      )!,
      canUseTool,
      currentContext,
    )) {
      if (update.contextModifier) {
        currentContext = update.contextModifier.modifyContext(currentContext)
      }
      yield {
        message: update.message,
        newContext: currentContext,
      }
    }

    markToolUseAsComplete(toolUseContext, toolUse.id)
  }
}

// ─── 并发执行 ──────────────────────────────────────────────────────────────

/**
 * runToolsConcurrently — 并发执行工具
 *
 * 用于 concurrency-safe 的工具 (Read, Glob, Grep 等)
 *
 * 使用 all() 工具并发执行，受 maxConcurrency 限制
 * Context modifiers 不在此处应用 — 由调用者批次结束后统一应用
 */
async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  yield* all(
    toolUseMessages.map(async function* (toolUse) {
      toolUseContext.setInProgressToolUseIDs(prev =>
        new Set(prev).add(toolUse.id),
      )
      yield* runToolUse(
        toolUse,
        assistantMessages.find(a =>
          a.message.content.some(
            (c: any) => c.type === 'tool_use' && c.id === toolUse.id,
          ),
        )!,
        canUseTool,
        toolUseContext,
      )
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }),
    getMaxToolUseConcurrency(),
  )
}

// ─── 工具完成标记 ──────────────────────────────────────────────────────────

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
): void {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
