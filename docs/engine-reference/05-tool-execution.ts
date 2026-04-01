/**
 * 05-tool-execution.ts — 单个工具执行
 *
 * 源自: src/services/tools/toolExecution.ts
 *
 * 负责执行单个 tool_use block:
 * 查找工具 → Zod 验证 → pre-tool hooks → 权限检查 → tool.call() → post-tool hooks
 *
 * 剥离: analytics/telemetry (logEvent), OTel tracing, MCP auth error handling,
 *       speculative classifier, session activity tracking, deferred tool hints,
 *       git commit tracking, bash tool-specific logic, progress reporting stream
 * 保留: 完整的执行流程骨架, 权限检查, 错误处理, hook 集成
 */

import type {
  Message,
  AssistantMessage,
  ToolUseContext,
  CanUseToolFn,
  PermissionResult,
  Tool,
} from './00-types.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** 工具调用块 */
export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** 工具执行的消息更新 (lazy — 带 contextModifier) */
export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/** 查找工具 */
function findToolByName(tools: readonly Tool[], name: string): Tool | undefined {
  return tools.find(
    t => t.name === name || (t.aliases && t.aliases.includes(name))
  )
}

/** 创建 tool_result 消息 */
function createToolResultMessage(
  toolUseId: string,
  content: string,
  isError: boolean,
  assistantMessage: AssistantMessage,
): Message {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          content: isError ? `<tool_use_error>${content}</tool_use_error>` : content,
          is_error: isError,
          tool_use_id: toolUseId,
        },
      ],
    },
    uuid: `tool-result-${toolUseId}`,
    timestamp: Date.now(),
    toolUseResult: content,
    sourceToolAssistantUUID: (assistantMessage as any).uuid,
  } as unknown as Message
}

/** 创建取消消息 */
function createCancelMessage(
  toolUseId: string,
  assistantMessage: AssistantMessage,
): Message {
  return createToolResultMessage(
    toolUseId,
    'Tool execution was cancelled',
    false,
    assistantMessage,
  )
}

// ─── 核心执行 ──────────────────────────────────────────────────────────────

/**
 * runToolUse — 单个工具执行入口
 *
 * 源自 src/services/tools/toolExecution.ts:runToolUse()
 *
 * 完整流程:
 *
 * 1. 查找工具 (findToolByName)
 *    - 先在 available tools 中查找
 *    - 找不到则检查 deprecated aliases (如 KillShell → TaskStop)
 *    - 仍找不到 → yield 错误消息并 return
 *
 * 2. 检查 abort
 *    - 如果 signal.aborted → yield 取消消息并 return
 *
 * 3. 调用 streamedCheckPermissionsAndCallTool()
 *    - 使用 Stream 实现: 进度事件和最终结果合并为单一 async iterable
 *    - 内部调用 checkPermissionsAndCallTool()
 *
 * 4. 错误处理
 *    - 任何异常 → yield tool_result 错误消息
 */
export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  const toolName = toolUse.name

  // ── 1. 查找工具 ─────────────────────────────────────────────────────
  let tool = findToolByName(toolUseContext.options.tools, toolName)

  // 检查 deprecated aliases
  if (!tool) {
    // 生产版本: 从 getAllBaseTools() 中查找
    // const fallbackTool = findToolByName(getAllBaseTools(), toolName)
    // if (fallbackTool?.aliases?.includes(toolName)) tool = fallbackTool
  }

  if (!tool) {
    yield {
      message: createToolResultMessage(
        toolUse.id,
        `Error: No such tool available: ${toolName}`,
        true,
        assistantMessage,
      ),
    }
    return
  }

  const toolInput = toolUse.input

  try {
    // ── 2. 检查 abort ───────────────────────────────────────────────
    if (toolUseContext.abortController.signal.aborted) {
      yield {
        message: createCancelMessage(toolUse.id, assistantMessage),
      }
      return
    }

    // ── 3. 检查权限并调用 ───────────────────────────────────────────
    for await (const update of checkPermissionsAndCallTool(
      tool,
      toolUse.id,
      toolInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
    )) {
      yield update
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    yield {
      message: createToolResultMessage(
        toolUse.id,
        `Error calling tool (${tool.name}): ${errorMsg}`,
        true,
        assistantMessage,
      ),
    }
  }
}

// ─── 权限检查 + 工具调用 ────────────────────────────────────────────────────

/**
 * checkPermissionsAndCallTool — 权限验证 + 执行
 *
 * 源自 src/services/tools/toolExecution.ts:checkPermissionsAndCallTool()
 *
 * 完整流程:
 *
 * 1. Zod 输入验证 (tool.inputSchema.safeParse)
 *    - 失败 → 返回 InputValidationError
 *    - 如果是 deferred tool 且 schema 未发送 → 附加提示先调用 ToolSearch
 *
 * 2. 自定义输入验证 (tool.validateInput)
 *    - 失败 → 返回验证错误
 *
 * 3. Pre-tool hooks (runPreToolUseHooks)
 *    - PreToolUse hooks 可以:
 *      a. 提供 hookPermissionResult (覆盖正常权限检查)
 *      b. 修改 input (hookUpdatedInput)
 *      c. 阻止执行 (preventContinuation)
 *      d. 直接停止 (stop)
 *
 * 4. 权限检查 (canUseTool)
 *    - 如果 pre-tool hook 已提供结果 → 使用 hook 结果
 *    - 否则 → 调用 canUseTool(tool, input)
 *    - 结果: allow / deny / ask
 *    - deny → 返回权限拒绝消息
 *    - ask → 在交互模式下提示用户
 *
 * 5. 工具执行 (tool.call)
 *    - tool.call(parsedInput, toolUseContext)
 *    - 返回 ToolResult
 *
 * 6. 结果处理 (mapToolResultToToolResultBlockParam)
 *    - 将 ToolResult 转换为 API 格式的 tool_result
 *    - 处理 image/document 结果
 *    - 处理 contextModifier
 *
 * 7. Post-tool hooks (runPostToolUseHooks)
 *    - PostToolUse hooks 可以:
 *      a. 修改结果
 *      b. 阻止继续
 *
 * 8. 如果 preventContinuation → yield hook_stopped_continuation attachment
 */
async function* checkPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
): AsyncGenerator<MessageUpdateLazy, void> {
  // ── 1. Zod 输入验证 ─────────────────────────────────────────────────
  const parsedInput = tool.inputSchema.safeParse(input)
  if (!parsedInput.success) {
    yield {
      message: createToolResultMessage(
        toolUseID,
        `InputValidationError: ${parsedInput.error.message}`,
        true,
        assistantMessage,
      ),
    }
    return
  }

  // ── 2. 自定义输入验证 ───────────────────────────────────────────────
  if (tool.validateInput) {
    const isValid = await tool.validateInput(parsedInput.data, toolUseContext)
    if (isValid?.result === false) {
      yield {
        message: createToolResultMessage(
          toolUseID,
          isValid.message || 'Input validation failed',
          true,
          assistantMessage,
        ),
      }
      return
    }
  }

  // ── 3. Pre-tool hooks ───────────────────────────────────────────────
  // 生产版本: runPreToolUseHooks()
  // hooks 可以提供 hookPermissionResult, hookUpdatedInput, preventContinuation, stop

  // ── 4. 权限检查 ─────────────────────────────────────────────────────
  const permissionResult = await canUseTool(
    tool,
    parsedInput.data,
    toolUseContext,
  )

  if (permissionResult.behavior === 'deny') {
    yield {
      message: createToolResultMessage(
        toolUseID,
        permissionResult.message || 'Permission denied',
        true,
        assistantMessage,
      ),
    }

    // 生产版本: executePermissionDeniedHooks()
    return
  }

  // ── 5. 工具执行 ─────────────────────────────────────────────────────
  let processedInput = parsedInput.data

  // 如果权限结果提供了 updatedInput (例如 sed edit 替换)
  if (permissionResult.updatedInput) {
    processedInput = permissionResult.updatedInput
  }

  const toolResult = await tool.call(processedInput, toolUseContext)

  // ── 6. 结果处理 ─────────────────────────────────────────────────────
  const resultBlock = tool.mapToolResultToToolResultBlockParam
    ? tool.mapToolResultToToolResultBlockParam(toolResult, toolUseID)
    : {
        type: 'tool_result' as const,
        content: typeof toolResult.output === 'string'
          ? toolResult.output
          : JSON.stringify(toolResult.output),
        tool_use_id: toolUseID,
      }

  const resultMessage = {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: [resultBlock],
    },
    uuid: `tool-result-${toolUseID}`,
    timestamp: Date.now(),
    toolUseResult: typeof toolResult.output === 'string'
      ? toolResult.output
      : JSON.stringify(toolResult.output),
    sourceToolAssistantUUID: (assistantMessage as any).uuid,
  } as unknown as Message

  const update: MessageUpdateLazy = { message: resultMessage }

  // 附加 contextModifier (如果工具结果包含)
  if (toolResult.contextModifier) {
    update.contextModifier = {
      toolUseID,
      modifyContext: toolResult.contextModifier,
    }
  }

  yield update

  // ── 7. Post-tool hooks ──────────────────────────────────────────────
  // 生产版本: runPostToolUseHooks()
  // hooks 可以:
  // - 修改结果 (rare)
  // - 阻止继续 (preventContinuation)
  // - 发出错误 (failure hooks)
}
