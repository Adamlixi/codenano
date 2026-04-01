/**
 * 03-model-service.ts — 模型调用层
 *
 * 源自: src/services/api/claude.ts
 *
 * 负责将消息 + system prompt + tools 发送给 Claude API，
 * 处理流式响应，组装 AssistantMessage。
 *
 * 剥离: prompt caching 策略, beta headers, GrowthBook feature gates,
 *       tool search / deferred tools, advisor, fingerprint attribution,
 *       non-streaming fallback retry, VCR 录制, analytics/telemetry,
 *       prompt-cache-break detection, 529 rate limit handling,
 *       session activity tracking, media stripping, Bedrock inference profiles
 * 保留: 核心 streaming 调用流, 消息规范化, 系统提示构建,
 *       tool schema 构建, AssistantMessage 组装
 */

import type {
  Message,
  AssistantMessage,
  UserMessage,
  StreamEvent,
  ThinkingConfig,
  Tool,
} from './00-types.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** 简化的 API 调用选项 */
export type ModelCallOptions = {
  model: string
  tools: Tool[]
  signal: AbortSignal
  maxOutputTokens?: number
  fallbackModel?: string
  querySource?: string
  thinkingConfig: ThinkingConfig
  /** API-side task budget — 让模型自己 pacing */
  taskBudget?: { total: number; remaining?: number }
}

/**
 * 流式事件 — 对应 Anthropic SDK 的 BetaRawMessageStreamEvent
 *
 * 简化版: 只保留 Agent 循环需要的事件类型
 */
export type StreamEventType =
  | 'message_start'
  | 'message_delta'
  | 'message_stop'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'

/** 非流式回退结果 */
export type NonStreamingResult = {
  assistantMessage: AssistantMessage
}

// ─── 核心调用函数 ──────────────────────────────────────────────────────────

/**
 * queryModelWithStreaming — 流式模型调用
 *
 * 源自 claude.ts 的 queryModelWithStreaming() + queryModel()
 *
 * 核心流程:
 * 1. 规范化消息 (normalizeMessagesForAPI)
 * 2. 构建 system prompt blocks
 * 3. 构建 tool schemas (toolToAPISchema)
 * 4. 调用 Anthropic API (streaming)
 * 5. 消费流事件，组装 AssistantMessage
 * 6. yield StreamEvent + AssistantMessage
 *
 * 实际生产代码涉及:
 * - withStreamingVCR: 录制/回放流式调用 (测试用)
 * - withRetry: 自动重试 + fallback model 切换
 * - prompt caching: cache_control breakpoints, 1h TTL
 * - tool search: deferred loading, tool_reference blocks
 * - fingerprint: 归因追踪
 * - beta headers: 多种 feature 的 beta 头
 */
export async function* queryModelWithStreaming(params: {
  messages: Message[]
  systemPrompt: string[]
  thinkingConfig: ThinkingConfig
  tools: Tool[]
  signal: AbortSignal
  options: ModelCallOptions
}): AsyncGenerator<StreamEvent | AssistantMessage, void> {
  // ─── 简化实现 (生产版本见 src/services/api/claude.ts) ───────────────

  // 生产版本的完整流程:
  //
  // 1. 消息规范化
  //    messagesForAPI = normalizeMessagesForAPI(messages, filteredTools)
  //    - 剥离内部字段 (uuid, timestamp, isMeta, etc.)
  //    - 确保 tool_use/tool_result 配对
  //    - 处理 tool_reference blocks (tool search)
  //    - 剥离 advisor blocks (如果无 beta header)
  //    - 限制 media 数量 (< 100)
  //
  // 2. 构建 system prompt
  //    system = buildSystemPromptBlocks(systemPrompt, enablePromptCaching)
  //    - 添加 attribution header + CLI sysprompt prefix
  //    - 添加 cache_control breakpoints
  //    - 添加 advisor/chrome 指令
  //
  // 3. 构建 tool schemas
  //    toolSchemas = await Promise.all(
  //      filteredTools.map(tool => toolToAPISchema(tool, { ... }))
  //    )
  //    - 过滤 deferred tools (tool search)
  //    - 添加 defer_loading 标记
  //    - 添加 extra tool schemas (advisor)
  //
  // 4. 构建请求参数
  //    paramsFromContext = (context: RetryContext) => ({
  //      model: context.model,
  //      max_tokens: getMaxOutputTokens(context),
  //      messages: messageParams,
  //      system,
  //      tools: allTools,
  //      thinking: thinkingParams,
  //      temperature: 1,
  //      metadata: getAPIMetadata(),
  //      betas,
  //      ...extraBodyParams,
  //    })
  //
  // 5. 流式调用 (withRetry + streaming)
  //    const stream = anthropic.beta.messages.stream(params, { signal })
  //
  //    对于每个流事件:
  //    - message_start: 记录 request ID, 开始计时
  //    - content_block_start: 新 content block (text/tool_use/thinking)
  //    - content_block_delta: 增量内容
  //    - content_block_stop: block 完成
  //    - message_delta: usage update, stop_reason
  //    - message_stop: 完成
  //
  // 6. 错误处理
  //    - 413 OverloadedError → 触发 reactive compact
  //    - 529 RateLimitError → 重试 (withRetry)
  //    - AbortError → 用户中断
  //    - streaming 中断 → 非流式 fallback (executeNonStreamingRequest)
  //
  // 7. 结果组装
  //    将流事件组装为 AssistantMessage:
  //    {
  //      type: 'assistant',
  //      message: {
  //        id: response.id,
  //        role: 'assistant',
  //        content: [...contentBlocks],
  //        model: response.model,
  //        stop_reason: response.stop_reason,
  //        usage: response.usage,
  //      },
  //      requestId: response.headers['request-id'],
  //    }

  throw new Error(
    'queryModelWithStreaming is a structural placeholder. ' +
    'In production, this delegates to the Anthropic SDK streaming API ' +
    'via withRetry() + withStreamingVCR(). ' +
    'See src/services/api/claude.ts:queryModel() for the full implementation.'
  )
}

/**
 * queryModelWithoutStreaming — 非流式模型调用
 *
 * 用于 fallback 场景 (streaming 中断后回退)
 *
 * 调用 queryModelWithStreaming 收集完整响应，
 * 或直接调用 anthropic.beta.messages.create()
 */
export async function queryModelWithoutStreaming(params: {
  messages: Message[]
  systemPrompt: string[]
  thinkingConfig: ThinkingConfig
  tools: Tool[]
  signal: AbortSignal
  options: ModelCallOptions
}): Promise<AssistantMessage> {
  // 生产版本:
  // 1. 通过 withStreamingVCR 包装
  // 2. 调用 queryModel() generator
  // 3. 消费所有事件，返回最终 AssistantMessage
  // 4. 如果 signal.aborted → throw APIUserAbortError

  throw new Error(
    'queryModelWithoutStreaming is a structural placeholder. ' +
    'See src/services/api/claude.ts:queryModelWithoutStreaming() for the full implementation.'
  )
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/**
 * normalizeMessagesForAPI — 规范化消息用于 API 发送
 *
 * 源自 src/utils/messages.ts:normalizeMessagesForAPI()
 *
 * - 过滤 internal-only 消息 (progress, attachment, system)
 * - 剥离内部字段 (uuid, timestamp, isMeta, etc.)
 * - 保证 user/assistant 交替
 * - 确保 tool_use/tool_result 配对
 * - 处理 connector_text blocks
 */
export function normalizeMessagesForAPI(
  messages: Message[],
  _tools: Tool[],
): (UserMessage | AssistantMessage)[] {
  return messages.filter(
    (m): m is UserMessage | AssistantMessage =>
      m.type === 'user' || m.type === 'assistant'
  )
}

/**
 * toolToAPISchema — 将内部 Tool 转换为 API tool schema
 *
 * 源自 src/utils/api.ts:toolToAPISchema()
 *
 * {
 *   name: tool.name,
 *   description: tool.prompt,
 *   input_schema: zodToJsonSchema(tool.inputSchema),
 *   ...(deferLoading ? { defer_loading: true } : {}),
 * }
 */
export function toolToAPISchema(
  tool: Tool,
  _options?: { deferLoading?: boolean },
): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.prompt,
    input_schema: {}, // 生产版本: zodToJsonSchema(tool.inputSchema)
  }
}

/**
 * getMaxOutputTokens — 获取模型最大输出 token 数
 *
 * 源自 src/utils/context.ts
 *
 * 默认值: CAPPED_DEFAULT_MAX_TOKENS (通常 16384)
 * 可通过 maxOutputTokensOverride 覆盖
 * 某些恢复路径升级到 MAX_OUTPUT_TOKENS_LARGE (65536)
 */
export const CAPPED_DEFAULT_MAX_TOKENS = 16384
export const MAX_OUTPUT_TOKENS_LARGE = 65536
export const MAX_NON_STREAMING_TOKENS = 8192

/**
 * createAssistantAPIErrorMessage — 创建 API 错误消息
 *
 * 源自 src/utils/messages.ts
 *
 * 用于 queryLoop 中的错误恢复路径
 */
export function createAssistantAPIErrorMessage(
  message: string,
  model: string,
): Message {
  return {
    type: 'assistant' as const,
    message: {
      id: `error-${Date.now()}`,
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: message }],
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    uuid: `error-${Date.now()}`,
    timestamp: Date.now(),
  } as unknown as Message
}

// ─── 重试逻辑 (withRetry) ──────────────────────────────────────────────────

/**
 * withRetry — 请求重试 + fallback model 切换
 *
 * 源自 src/services/api/withRetry.ts
 *
 * 重试策略:
 * - 429 RateLimitError: 按 retry-after header 等待
 * - 529 OverloadedError: 指数退避 (1s, 2s, 4s, 8s)
 * - 500 InternalServerError: 最多 2 次重试
 * - fallbackModel: 当主模型连续失败时切换
 * - CannotRetryError: 413/401/403 等不可重试错误
 *
 * RetryContext:
 * {
 *   model: string           // 当前使用的模型 (可能已 fallback)
 *   maxOutputTokens: number // 当前 max_tokens (恢复路径可能升级)
 *   attempt: number         // 当前尝试次数
 *   consecutive529Errors: number
 * }
 */

// ─── 流式中断 fallback ────────────────────────────────────────────────────

/**
 * executeNonStreamingRequest — 非流式 fallback
 *
 * 源自 src/services/api/claude.ts:executeNonStreamingRequest()
 *
 * 当流式请求中断时 (连接断开, 超时等):
 * 1. 使用相同参数发起非流式请求
 * 2. 超时: 远程 120s, 本地 300s
 * 3. 结果转换为 AssistantMessage
 *
 * 注意: 非流式的 max_tokens 上限为 MAX_NON_STREAMING_TOKENS (8192)
 */
