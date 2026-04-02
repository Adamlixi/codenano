/**
 * agent.ts — Core Agent implementation
 *
 * This is the main agent loop that connects the Claude API to tool execution.
 * It implements the same while(true) pattern as codenano's queryLoop:
 *   call model → check for tool_use → execute tools → repeat
 *
 * Phase 1 features:
 *   - Tool concurrency: partitionToolCalls() + concurrent batch execution
 *   - Auto-compact: token threshold check → LLM summarization before model call
 *   - 413 recovery: detect prompt-too-long → compact → retry once
 *
 * Phase 2 features:
 *   - Max output recovery: detect max_tokens → inject "resume" → retry (up to 3x)
 *   - Model fallback: 3x consecutive 529 → switch to fallbackModel
 *   - Tool result budgeting: truncate oversized tool results (50KB per-tool, 200KB per-message)
 *   - CLAUDE.md instructions: auto-load project instructions into system prompt
 *
 * Phase 3 (P1) features:
 *   - Streaming tool executor: tools start executing while model still streaming
 *   - Max output escalation: 8k→64k before resume inject
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type {
  AgentConfig,
  Agent,
  Result,
  StreamEvent,
  ToolDef,
  Usage,
  ToolContext,
  ToolOutput,
  QueryTracking,
} from './types.js'
import { SessionImpl } from './session.js'
import {
  createClient,
  toolDefsToAPISchemas,
  callModelStreamingWithRetry,
  buildToolResultMessage,
  mergeConsecutiveUserMessages,
  FallbackTriggeredError,
  CAPPED_DEFAULT_MAX_TOKENS,
  ESCALATED_MAX_TOKENS,
  type ModelStreamEvent,
  type ModelCallResult,
} from './provider.js'
import { toPublicEvent } from './events.js'
import { buildSystemPrompt, buildEffectiveSystemPrompt, detectEnvironment } from './prompt/index.js'
import { shouldAutoCompact, compactMessages, isPromptTooLongError } from './compact.js'
import { loadInstructions } from './instructions.js'
import { applyMessageBudget } from './tool-budget.js'
import { StreamingToolExecutor } from './streaming-tool-executor.js'
import { partitionToolCalls, executeSingleTool, executeBatchConcurrently } from './tool-executor.js'
import { snipIfNeeded } from './snip-compact.js'
import { microcompact } from './microcompact.js'
import { createMemoryExtractor } from './memory/index.js'

// ─── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_MAX_TURNS = 30
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MAX_OUTPUT_RECOVERY_LIMIT = 3

const MAX_OUTPUT_RECOVERY_MESSAGE =
  'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
  'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.'

// ─── createAgent ────────────────────────────────────────────────────────────

/**
 * Create an Agent instance.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   model: 'claude-sonnet-4-6',
 *   tools: [readFile, writeFile],
 *   systemPrompt: 'You are a helpful coding assistant.',
 * })
 *
 * const result = await agent.ask('What files are in /tmp?')
 * ```
 */
export function createAgent(config: AgentConfig): Agent {
  const resolvedConfig: AgentConfig = {
    ...config,
    model: config.model ?? DEFAULT_MODEL,
    maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
    tools: config.tools ?? [],
  }

  return new AgentImpl(resolvedConfig)
}

// ─── AgentImpl ──────────────────────────────────────────────────────────────

class AgentImpl implements Agent {
  private config: AgentConfig
  private client: Anthropic
  private toolSchemas: Anthropic.Messages.Tool[]
  private toolMap: Map<string, ToolDef>
  private abortController: AbortController
  private resolvedSystemPrompt: string | null = null
  /** Current active model — may switch to fallbackModel on 529 errors */
  private activeModel: string
  /** Query tracking for current execution */
  private queryTracking: QueryTracking | null = null
  /** Stop hook retry counter */
  private stopHookRetryCount = 0
  private readonly MAX_HOOK_RETRIES = 3
  /** Memory extractor (if extraction is enabled) */
  private memoryExtractor: ReturnType<typeof createMemoryExtractor> | null = null

  constructor(config: AgentConfig) {
    this.config = config
    this.activeModel = config.model
    this.client = createClient(config)
    this.toolSchemas = toolDefsToAPISchemas(config.tools ?? [])
    this.toolMap = new Map((config.tools ?? []).map(t => [t.name, t]))
    this.abortController = new AbortController()

    // Initialize memory extractor if strategy is not disabled
    const strategy = config.memory?.extractStrategy
    if (strategy && strategy !== 'disabled') {
      this.memoryExtractor = createMemoryExtractor({
        client: this.client,
        model: config.model,
        memoryDir: config.memory?.memoryDir,
        extractStrategy: strategy,
        extractMaxTurns: config.memory?.extractMaxTurns,
      })
    }
  }

  /**
   * Resolve the system prompt using the prompt builder.
   * Uses priority chain: overrideSystemPrompt > systemPrompt > built prompt
   * Optionally loads CLAUDE.md instructions and appends them.
   */
  private async getSystemPrompt(): Promise<string> {
    if (this.resolvedSystemPrompt !== null) return this.resolvedSystemPrompt

    // Build the default prompt from sections
    const defaultPrompt = await buildSystemPrompt({
      identity: this.config.identity,
      model: this.config.model,
      tools: this.config.tools,
      language: this.config.language,
      environment: detectEnvironment(),
      memoryDir: this.config.memory?.autoLoad !== false ? this.config.memory?.memoryDir : undefined,
    })

    // Apply priority chain
    const effective = buildEffectiveSystemPrompt({
      overridePrompt: this.config.overrideSystemPrompt,
      customPrompt: this.config.systemPrompt,
      defaultPrompt: [...defaultPrompt],
      appendPrompt: this.config.appendSystemPrompt,
    })

    let prompt = [...effective].filter(Boolean).join('\n\n')

    // Auto-load CLAUDE.md project instructions if enabled
    if (this.config.autoLoadInstructions) {
      const instructions = await loadInstructions()
      if (instructions) {
        prompt = prompt + '\n\n' + instructions
      }
    }

    this.resolvedSystemPrompt = prompt
    return this.resolvedSystemPrompt
  }

  /** Get the effective config with active model (may be fallback) */
  private getActiveConfig(): AgentConfig {
    if (this.activeModel === this.config.model) return this.config
    return { ...this.config, model: this.activeModel }
  }

  async ask(prompt: string): Promise<Result> {
    let result: Result | undefined
    for await (const event of this.runAgentLoop(prompt, [])) {
      if (event.type === 'result') {
        result = event.result
      }
    }
    if (!result) {
      throw new Error('Agent loop completed without producing a result')
    }
    return result
  }

  stream(prompt: string): AsyncIterable<StreamEvent> {
    return this.runAgentLoop(prompt, [])
  }

  session(): SessionImpl {
    return new SessionImpl(this.config, this.client, this.toolSchemas, this.toolMap)
  }

  abort(): void {
    this.abortController.abort()
    this.abortController = new AbortController()
  }

  // ─── Agent Loop ─────────────────────────────────────────────────────

  /**
   * The main agent loop — mirrors queryLoop() from codenano.
   *
   * while (true) {
   *   0. Auto-compact if approaching context limit
   *   1. Call model (streaming, with retry + fallback)
   *   2. Collect assistant response + tool_use blocks
   *   3. If max_tokens → inject "resume" message → retry (up to 3x)
   *   4. If no tool_use → done
   *   5. Execute tools (concurrent batching) → apply result budget → continue
   * }
   *
   * On 413 error: compact conversation and retry once.
   * On 3x 529 error: switch to fallbackModel (if configured).
   */
  private async *runAgentLoop(
    prompt: string,
    existingMessages: MessageParam[],
  ): AsyncGenerator<StreamEvent, void> {
    const startTime = Date.now()
    let messages: MessageParam[] = [...existingMessages, { role: 'user', content: prompt }]

    const maxTurns = this.config.maxTurns ?? DEFAULT_MAX_TURNS
    const systemPrompt = await this.getSystemPrompt()
    let turnCount = 0
    let lastStopReason = 'end_turn'
    let hasAttemptedCompact = false
    let maxOutputRecoveryCount = 0
    let maxOutputTokensOverride: number | undefined
    let lastUsage: Usage | undefined
    const totalUsage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }

    // Initialize or increment query tracking
    const queryTracking: QueryTracking = this.queryTracking
      ? {
          chainId: this.queryTracking.chainId,
          depth: this.queryTracking.depth + 1,
        }
      : {
          chainId: crypto.randomUUID(),
          depth: 0,
        }
    this.queryTracking = queryTracking

    // Emit query_start event
    yield { type: 'query_start', queryTracking }

    const maxRecoveryAttempts = this.config.maxOutputRecoveryAttempts ?? MAX_OUTPUT_RECOVERY_LIMIT
    const useStreamingExecution = this.config.streamingToolExecution !== false
    const enableBudget = this.config.toolResultBudget !== false
    const capEnabled = this.config.maxOutputTokensCap === true

    // Apply initial cap if enabled (8K instead of default 16K)
    if (capEnabled && !this.config.maxOutputTokens) {
      maxOutputTokensOverride = CAPPED_DEFAULT_MAX_TOKENS
    }

    while (turnCount < maxTurns) {
      turnCount++

      // Check abort
      if (this.abortController.signal.aborted) {
        this.abortController = new AbortController()
        break
      }

      // turn_start will be yielded by toPublicEvent when message_start arrives

      // ── Snip old messages (fast, zero-cost) ────────────────────────
      const snipResult = snipIfNeeded(messages)
      if (snipResult.snipped) {
        messages = snipResult.messages
      }

      // ── Microcompact tool results (fast, zero-cost) ────────────────
      const microResult = microcompact(messages)
      if (microResult.compressed > 0) {
        messages = microResult.messages
      }

      // ── Auto-compact check ──────────────────────────────────────────
      if (this.config.autoCompact !== false && lastUsage) {
        if (shouldAutoCompact(messages, this.config, lastUsage)) {
          const compacted = await compactMessages(
            messages,
            systemPrompt,
            this.client,
            this.config,
            this.abortController.signal,
          )
          if (compacted) {
            messages = compacted
            hasAttemptedCompact = true
          }
        }
      }

      // ── Call model (streaming with retry + fallback) ───────────────
      let modelResult: ModelCallResult | undefined
      let modelError: unknown = null
      const normalizedMessages = mergeConsecutiveUserMessages(messages)

      // Create streaming tool executor for this turn
      const streamingExecutor =
        useStreamingExecution && (this.config.tools?.length ?? 0) > 0
          ? new StreamingToolExecutor(
              this.toolMap,
              this.config,
              this.abortController.signal,
              messages,
              enableBudget,
            )
          : null

      // Track completed tool_use blocks during streaming
      const completedToolBlocks: Map<number, Anthropic.ToolUseBlock> = new Map()
      const pendingToolBlocks: Map<
        number,
        Partial<Anthropic.ToolUseBlock> & { _inputJson?: string }
      > = new Map()

      try {
        for await (const event of callModelStreamingWithRetry(
          this.client,
          normalizedMessages,
          systemPrompt,
          this.toolSchemas,
          this.getActiveConfig(),
          this.abortController.signal,
          maxOutputTokensOverride,
        )) {
          // Yield public stream events (skip tool_use and turn_end, we handle them manually)
          const publicEvent = toPublicEvent(event, turnCount)
          if (publicEvent && publicEvent.type !== 'tool_use' && publicEvent.type !== 'turn_end') {
            yield publicEvent
          }

          // ── Feed streaming tool executor ──────────────────────────
          if (streamingExecutor) {
            if (event.type === 'tool_use_start') {
              pendingToolBlocks.set(
                [...pendingToolBlocks.keys()].length, // index placeholder
                { id: event.id, name: event.name, type: 'tool_use', input: {}, _inputJson: '' },
              )
            }
          }

          // Track content_block_stop to detect completed tool_use blocks
          if (event.type === 'content_block_stop' && modelResult === undefined) {
            // The block is finalized — handled below via modelResult
          }

          // Capture the final result
          if (event.type === 'message_complete') {
            modelResult = event.result
          }
        }

        // After stream completes, feed completed tool_use blocks to executor
        if (streamingExecutor && modelResult) {
          const toolUseBlocks = modelResult.assistantContent.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          )
          for (const block of toolUseBlocks) {
            yield {
              type: 'tool_use',
              toolName: block.name,
              toolUseId: block.id,
              input: block.input,
            }
            streamingExecutor.addTool(block)
          }

          // Yield any results that completed during addTool processing
          for (const result of streamingExecutor.getCompletedResults()) {
            // tool_use events already yielded above
          }
        }
      } catch (error) {
        // Discard streaming executor on error
        if (streamingExecutor) {
          for (const result of streamingExecutor.discard()) {
            // Yield synthetic error results
          }
        }

        // ── Model Fallback ────────────────────────────────────────
        if (error instanceof FallbackTriggeredError && this.config.fallbackModel) {
          this.activeModel = this.config.fallbackModel
          yield {
            type: 'error',
            error: new Error(
              `Switched to ${this.config.fallbackModel} due to high demand for ${this.config.model}`,
            ),
          }
          turnCount-- // Retry this turn with fallback model
          continue
        }
        modelError = error
      }

      // ── 413 Recovery ──────────────────────────────────────────────
      if (modelError && isPromptTooLongError(modelError) && !hasAttemptedCompact) {
        const compacted = await compactMessages(
          messages,
          systemPrompt,
          this.client,
          this.config,
          this.abortController.signal,
        )
        if (compacted) {
          messages = compacted
          hasAttemptedCompact = true
          turnCount-- // Retry this turn
          continue
        }
        yield {
          type: 'error',
          error: modelError instanceof Error ? modelError : new Error(String(modelError)),
        }
        break
      }

      if (modelError) {
        yield {
          type: 'error',
          error: modelError instanceof Error ? modelError : new Error(String(modelError)),
        }
        break
      }

      if (!modelResult) {
        yield { type: 'error', error: new Error('Model call produced no result') }
        break
      }

      // Track usage for auto-compact threshold
      lastUsage = modelResult.usage
      totalUsage.inputTokens += modelResult.usage.inputTokens
      totalUsage.outputTokens += modelResult.usage.outputTokens
      totalUsage.cacheCreationInputTokens += modelResult.usage.cacheCreationInputTokens
      totalUsage.cacheReadInputTokens += modelResult.usage.cacheReadInputTokens

      lastStopReason = modelResult.stopReason ?? 'end_turn'

      // Append assistant message to history
      messages.push({
        role: 'assistant',
        content: modelResult.assistantContent as ContentBlockParam[],
      })

      // ── Max Output Escalation + Recovery ───────────────────────────
      if (lastStopReason === 'max_tokens') {
        // Path 1: Escalation — retry same messages at 64K (no recovery message)
        // Skip if user explicitly set maxOutputTokens (they don't want auto-escalation)
        if (
          capEnabled &&
          maxOutputTokensOverride !== ESCALATED_MAX_TOKENS &&
          !this.config.maxOutputTokens
        ) {
          maxOutputTokensOverride = ESCALATED_MAX_TOKENS
          // Remove the assistant message we just added — retry with same messages
          messages.pop()
          turnCount-- // Retry this turn
          continue
        }

        // Path 2: Recovery inject — add "resume" message
        if (maxOutputRecoveryCount < maxRecoveryAttempts) {
          maxOutputRecoveryCount++
          // Reset override after escalation attempt
          if (capEnabled) {
            maxOutputTokensOverride = undefined
          }
          messages.push({ role: 'user', content: MAX_OUTPUT_RECOVERY_MESSAGE })
          continue // Retry — model will resume where it left off
        }
      }

      // Reset recovery counter on successful tool use
      const toolUseBlocks = modelResult.assistantContent.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )

      if (toolUseBlocks.length > 0) {
        maxOutputRecoveryCount = 0
        // Reset cap after successful tool execution
        if (capEnabled && !this.config.maxOutputTokens) {
          maxOutputTokensOverride = CAPPED_DEFAULT_MAX_TOKENS
        }
      }

      // ── No tool use → done ─────────────────────────────────────────
      if (toolUseBlocks.length === 0) {
        // Run stop hook if configured
        if (this.config.onTurnEnd) {
          const lastText = extractText(modelResult.assistantContent)
          const hookResult = await this.config.onTurnEnd({
            messages,
            lastResponse: lastText,
          })

          // Handle preventContinuation
          if (hookResult?.preventContinuation) {
            this.stopHookRetryCount = 0
            yield {
              type: 'turn_end',
              stopReason: 'stop_hook_prevented',
              turnNumber: turnCount,
            }
            yield {
              type: 'result',
              result: {
                text: lastText,
                messages: messages.map(simplifyMessage),
                usage: totalUsage,
                stopReason: 'stop_hook_prevented',
                numTurns: turnCount,
                durationMs: Date.now() - startTime,
                queryTracking,
              },
            }
            return
          }

          // Handle continueWith with retry limit
          if (hookResult?.continueWith) {
            if (this.stopHookRetryCount >= this.MAX_HOOK_RETRIES) {
              console.warn('Stop hook retry limit reached')
              this.stopHookRetryCount = 0
              yield {
                type: 'turn_end',
                stopReason: 'hook_retry_limit',
                turnNumber: turnCount,
              }
              yield {
                type: 'result',
                result: {
                  text: lastText,
                  messages: messages.map(simplifyMessage),
                  usage: totalUsage,
                  stopReason: 'hook_retry_limit',
                  numTurns: turnCount,
                  durationMs: Date.now() - startTime,
                  queryTracking,
                },
              }
              return
            }
            this.stopHookRetryCount++
            messages.push({ role: 'user', content: hookResult.continueWith })
            continue
          }
        }

        // Success - reset counter
        this.stopHookRetryCount = 0

        // Trigger memory extraction (fire-and-forget)
        if (this.memoryExtractor) {
          this.memoryExtractor.triggerExtraction(messages)
        }

        yield {
          type: 'turn_end',
          stopReason: lastStopReason,
          turnNumber: turnCount,
        }

        // Extract final text
        const finalText = extractText(modelResult.assistantContent)

        yield {
          type: 'result',
          result: {
            text: finalText,
            messages: messages.map(simplifyMessage),
            usage: totalUsage,
            stopReason: lastStopReason,
            numTurns: turnCount,
            durationMs: Date.now() - startTime,
            queryTracking,
          },
        }
        return
      }

      // ── Execute tools ──────────────────────────────────────────────
      yield {
        type: 'turn_end',
        stopReason: 'tool_use',
        turnNumber: turnCount,
      }

      const allToolResults: ContentBlockParam[] = []

      if (streamingExecutor) {
        // ── Streaming executor: tools already started during stream ──
        for await (const result of streamingExecutor.getRemainingResults()) {
          allToolResults.push(result.apiResult)
          yield result.event
        }
      } else {
        // ── Fallback: batch execution (streaming executor disabled) ──
        const batches = partitionToolCalls(toolUseBlocks, this.toolMap)

        for (const batch of batches) {
          if (batch.isConcurrencySafe && batch.blocks.length > 1) {
            for (const toolUse of batch.blocks) {
              const tool = this.toolMap.get(toolUse.name)
              if (tool) {
                const parsed = tool.input.safeParse(toolUse.input)
                if (parsed.success) {
                  yield {
                    type: 'tool_use',
                    toolName: toolUse.name,
                    toolUseId: toolUse.id,
                    input: parsed.data,
                  }
                }
              }
            }

            const concurrencyCap = Math.min(batch.blocks.length, 10)
            const results = await executeBatchConcurrently(
              batch.blocks,
              this.toolMap,
              this.config,
              this.abortController.signal,
              messages,
              concurrencyCap,
              enableBudget,
            )

            for (const r of results) {
              allToolResults.push(r.apiResult)
              yield r.event
            }
          } else {
            for (const toolUse of batch.blocks) {
              const { apiResult, events } = await executeSingleTool(
                toolUse,
                this.toolMap,
                this.config,
                this.abortController.signal,
                messages,
                enableBudget,
              )
              for (const evt of events) yield evt
              allToolResults.push(apiResult)
            }
          }
        }
      }

      // Apply per-message aggregate budget
      const budgetedResults = enableBudget ? applyMessageBudget(allToolResults) : allToolResults

      // Append tool results to messages
      messages.push({ role: 'user', content: budgetedResults })
    }

    // Max turns reached
    const lastText = extractLastAssistantText(messages)
    yield {
      type: 'result',
      result: {
        text: lastText,
        messages: messages.map(simplifyMessage),
        usage: totalUsage,
        stopReason: `max_turns (${maxTurns})`,
        numTurns: turnCount,
        durationMs: Date.now() - startTime,
        queryTracking,
      },
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}

function extractLastAssistantText(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      return msg.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
    }
  }
  return ''
}

function simplifyMessage(msg: MessageParam): MessageParam {
  return { role: msg.role, content: msg.content } as MessageParam
}

// Re-export for session.ts
export { AgentImpl }
