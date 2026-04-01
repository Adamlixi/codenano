/**
 * provider.ts — Anthropic API integration
 *
 * Connects to the Claude API via @anthropic-ai/sdk.
 * Handles streaming, message normalization, and tool schema conversion.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
  TextBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ToolDef, AgentConfig, Usage } from './types.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Internal message format used by the engine */
export interface InternalMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

/** Result from a single model call */
export interface ModelCallResult {
  message: Anthropic.Message
  assistantContent: Anthropic.ContentBlock[]
  stopReason: string | null
  usage: Usage
}

/** Stream event from the model */
export type ModelStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'input_json_delta'; partialJson: string }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_delta'; stopReason: string | null; usage: Partial<Usage> }
  | { type: 'message_complete'; result: ModelCallResult }

// ─── Client Creation ────────────────────────────────────────────────────────

export function createClient(config: AgentConfig): Anthropic {
  const provider = config.provider ?? detectProvider()

  if (provider === 'bedrock') {
    return createBedrockClient(config)
  }

  return new Anthropic({
    apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
    ...(config.baseURL ?? process.env.ANTHROPIC_BASE_URL
      ? { baseURL: config.baseURL ?? process.env.ANTHROPIC_BASE_URL }
      : {}),
    maxRetries: 2,
    timeout: 600_000,
  })
}

function createBedrockClient(config: AgentConfig): Anthropic {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk') as typeof import('@anthropic-ai/bedrock-sdk')

  const region = config.awsRegion ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1'

  return new AnthropicBedrock({
    awsRegion: region,
    timeout: 600_000,
  }) as unknown as Anthropic
}

function detectProvider(): 'anthropic' | 'bedrock' {
  if (
    process.env.CLAUDE_CODE_USE_BEDROCK === '1' ||
    process.env.ANTHROPIC_BEDROCK_BASE_URL ||
    (process.env.AWS_PROFILE && !process.env.ANTHROPIC_API_KEY)
  ) {
    return 'bedrock'
  }
  return 'anthropic'
}

// ─── Tool Schema Conversion ────────────────────────────────────────────────

/** Convert ToolDef[] to Anthropic API tool schemas */
export function toolDefsToAPISchemas(
  tools: ToolDef[],
): Anthropic.Messages.Tool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.input, {
      $refStrategy: 'none',
      target: 'openApi3',
    }) as Anthropic.Messages.Tool['input_schema'],
  }))
}

// ─── Streaming Model Call ──────────────────────────────────────────────────

/**
 * Call the model with streaming — yields events as they arrive,
 * then yields a final message_complete event.
 */
export async function* callModelStreaming(
  client: Anthropic,
  messages: MessageParam[],
  systemPrompt: string,
  tools: Anthropic.Messages.Tool[],
  config: AgentConfig,
  signal: AbortSignal,
  maxOutputTokensOverride?: number,
): AsyncGenerator<ModelStreamEvent, void> {
  const maxTokens = maxOutputTokensOverride ?? config.maxOutputTokens ?? 16384

  const stream = client.messages.stream(
    {
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt || undefined,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      ...(config.thinkingConfig === 'adaptive' && {
        thinking: { type: 'enabled', budget_tokens: Math.min(maxTokens - 1, 10000) },
        temperature: 1,
      }),
    },
    { signal },
  )

  let messageId = ''
  let stopReason: string | null = null
  let usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }

  for await (const event of stream) {
    switch (event.type) {
      case 'message_start': {
        messageId = event.message.id
        usage = {
          inputTokens: event.message.usage?.input_tokens ?? 0,
          outputTokens: event.message.usage?.output_tokens ?? 0,
          cacheCreationInputTokens: (event.message.usage as any)?.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: (event.message.usage as any)?.cache_read_input_tokens ?? 0,
        }
        yield { type: 'message_start', messageId }
        break
      }

      case 'content_block_start': {
        if (event.content_block.type === 'tool_use') {
          yield { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name }
        }
        break
      }

      case 'content_block_delta': {
        const delta = event.delta as any
        if (delta.type === 'text_delta') {
          // Don't mutate SDK's content block — finalMessage() handles accumulation
          yield { type: 'text_delta', text: delta.text }
        } else if (delta.type === 'thinking_delta') {
          yield { type: 'thinking_delta', thinking: delta.thinking }
        } else if (delta.type === 'input_json_delta') {
          yield { type: 'input_json_delta', partialJson: delta.partial_json }
        }
        break
      }

      case 'content_block_stop': {
        yield { type: 'content_block_stop', index: event.index }
        break
      }

      case 'message_delta': {
        stopReason = (event.delta as any).stop_reason ?? null
        const deltaUsage = event.usage as any
        if (deltaUsage?.output_tokens) {
          usage = { ...usage, outputTokens: deltaUsage.output_tokens }
        }
        yield { type: 'message_delta', stopReason, usage }
        break
      }

      case 'message_stop': {
        const finalMessage = await stream.finalMessage()
        // Use finalMessage.content as authoritative source — manual assembly
        // can diverge when proxies include text in content_block_start events
        const assembledContent = finalMessage.content as Anthropic.ContentBlock[]
        stopReason = finalMessage.stop_reason
        usage = {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          cacheCreationInputTokens: (finalMessage.usage as any).cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: (finalMessage.usage as any).cache_read_input_tokens ?? 0,
        }
        yield {
          type: 'message_complete',
          result: {
            message: finalMessage,
            assistantContent: assembledContent,
            stopReason,
            usage,
          },
        }
        break
      }
    }
  }
}

// ─── Non-streaming Model Call ──────────────────────────────────────────────

/** Call the model without streaming — returns the complete response */
export async function callModel(
  client: Anthropic,
  messages: MessageParam[],
  systemPrompt: string,
  tools: Anthropic.Messages.Tool[],
  config: AgentConfig,
  signal: AbortSignal,
): Promise<ModelCallResult> {
  const maxTokens = config.maxOutputTokens ?? 16384

  const response = await client.messages.create(
    {
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt || undefined,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      ...(config.thinkingConfig === 'adaptive' && {
        thinking: { type: 'enabled', budget_tokens: Math.min(maxTokens - 1, 10000) },
        temperature: 1,
      }),
    },
    { signal },
  )

  return {
    message: response,
    assistantContent: response.content,
    stopReason: response.stop_reason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: (response.usage as any).cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: (response.usage as any).cache_read_input_tokens ?? 0,
    },
  }
}

// ─── Retry with Backoff + Model Fallback ──────────────────────────────────

/**
 * Thrown when consecutive 529 errors trigger a model fallback.
 * Caught by the agent loop to switch models.
 */
export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
  }
}

const BASE_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 32_000
const MAX_RETRIES = 3
const MAX_529_RETRIES = 3

// ─── Max Output Token Escalation ─────────────────────────────────────────

/**
 * Capped default: most requests use 8K to save API slot capacity.
 * Matches codenano's CAPPED_DEFAULT_MAX_TOKENS.
 */
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000

/**
 * Escalation target: retry at 64K when 8K cap is hit.
 * Matches codenano's ESCALATED_MAX_TOKENS.
 */
export const ESCALATED_MAX_TOKENS = 64_000

/**
 * Calculate retry delay with exponential backoff + jitter.
 * Mirrors codenano's getRetryDelay() in withRetry.ts.
 */
export function getRetryDelay(attempt: number, maxDelay = MAX_RETRY_DELAY_MS): number {
  const baseDelay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt), maxDelay)
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

function isRetryableStatusError(error: unknown): boolean {
  const status = (error as any)?.status
  return status === 429 || status === 529
}

function is529Error(error: unknown): boolean {
  return (error as any)?.status === 529
}

/**
 * Call the model with streaming + automatic retry on transient errors.
 * On 3 consecutive 529s with a fallbackModel, throws FallbackTriggeredError.
 */
export async function* callModelStreamingWithRetry(
  client: Anthropic,
  messages: MessageParam[],
  systemPrompt: string,
  tools: Anthropic.Messages.Tool[],
  config: AgentConfig,
  signal: AbortSignal,
  maxOutputTokensOverride?: number,
): AsyncGenerator<ModelStreamEvent, void> {
  let consecutive529s = 0

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      for await (const event of callModelStreaming(
        client,
        messages,
        systemPrompt,
        tools,
        config,
        signal,
        maxOutputTokensOverride,
      )) {
        yield event
      }
      return // Success — exit retry loop
    } catch (error) {
      // Track consecutive 529s for fallback
      if (is529Error(error)) {
        consecutive529s++
        if (consecutive529s >= MAX_529_RETRIES && config.fallbackModel) {
          throw new FallbackTriggeredError(config.model, config.fallbackModel)
        }
      } else {
        consecutive529s = 0
      }

      // Retry on 429/529 if we have attempts left
      if (isRetryableStatusError(error) && attempt < MAX_RETRIES) {
        const delay = getRetryDelay(attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      throw error
    }
  }
}

// ─── Message Helpers ───────────────────────────────────────────────────────

/** Build a tool_result message from tool execution output */
export function buildToolResultMessage(
  toolUseId: string,
  output: string,
  isError: boolean,
): MessageParam {
  return {
    role: 'user' as const,
    content: [
      {
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        content: output,
        is_error: isError,
      },
    ],
  }
}

/** Merge consecutive user messages (API requires alternating roles) */
export function mergeConsecutiveUserMessages(
  messages: MessageParam[],
): MessageParam[] {
  const result: MessageParam[] = []
  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === 'user' && msg.role === 'user') {
      // Merge content arrays
      const lastContent = Array.isArray(last.content)
        ? last.content
        : [{ type: 'text' as const, text: last.content }]
      const newContent = Array.isArray(msg.content)
        ? msg.content
        : [{ type: 'text' as const, text: msg.content }]
      result[result.length - 1] = {
        role: 'user',
        content: [...lastContent, ...newContent] as ContentBlockParam[],
      }
    } else {
      result.push(msg)
    }
  }
  return result
}
