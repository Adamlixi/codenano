/**
 * session.ts — Multi-turn session management
 *
 * A Session accumulates conversation history across multiple send() calls,
 * allowing multi-turn interactions with the agent.
 *
 * Phase 1 + Phase 2 + Phase 3 (P1) features (same as agent.ts):
 *   - Tool concurrency, auto-compact, 413 recovery
 *   - Max output recovery, model fallback, tool result budgeting
 *   - Streaming tool executor, max output escalation
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type {
  AgentConfig,
  Session,
  Result,
  StreamEvent,
  ToolDef,
  Usage,
  ToolContext,
  ToolOutput,
  MessageParam as PublicMessageParam,
} from './types.js'
import {
  callModelStreamingWithRetry,
  mergeConsecutiveUserMessages,
  FallbackTriggeredError,
  CAPPED_DEFAULT_MAX_TOKENS,
  ESCALATED_MAX_TOKENS,
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

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_OUTPUT_RECOVERY_LIMIT = 3

const MAX_OUTPUT_RECOVERY_MESSAGE =
  'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
  'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.'

// ─── SessionImpl ────────────────────────────────────────────────────────────

export class SessionImpl implements Session {
  private config: AgentConfig
  private client: Anthropic
  private toolSchemas: Anthropic.Messages.Tool[]
  private toolMap: Map<string, ToolDef>
  private messages: MessageParam[] = []
  private abortController: AbortController = new AbortController()
  private resolvedSystemPrompt: string | null = null
  private activeModel: string

  constructor(
    config: AgentConfig,
    client: Anthropic,
    toolSchemas: Anthropic.Messages.Tool[],
    toolMap: Map<string, ToolDef>,
  ) {
    this.config = config
    this.activeModel = config.model
    this.client = client
    this.toolSchemas = toolSchemas
    this.toolMap = toolMap
  }

  private async getSystemPrompt(): Promise<string> {
    if (this.resolvedSystemPrompt !== null) return this.resolvedSystemPrompt

    const defaultPrompt = await buildSystemPrompt({
      identity: this.config.identity,
      model: this.config.model,
      tools: this.config.tools,
      language: this.config.language,
      environment: detectEnvironment(),
    })

    const effective = buildEffectiveSystemPrompt({
      overridePrompt: this.config.overrideSystemPrompt,
      customPrompt: this.config.systemPrompt,
      defaultPrompt: [...defaultPrompt],
      appendPrompt: this.config.appendSystemPrompt,
    })

    let prompt = [...effective].filter(Boolean).join('\n\n')

    if (this.config.autoLoadInstructions) {
      const instructions = await loadInstructions()
      if (instructions) {
        prompt = prompt + '\n\n' + instructions
      }
    }

    this.resolvedSystemPrompt = prompt
    return this.resolvedSystemPrompt
  }

  private getActiveConfig(): AgentConfig {
    if (this.activeModel === this.config.model) return this.config
    return { ...this.config, model: this.activeModel }
  }

  async send(prompt: string): Promise<Result> {
    let result: Result | undefined
    for await (const event of this.runSessionTurn(prompt)) {
      if (event.type === 'result') {
        result = event.result
      }
    }
    if (!result) {
      throw new Error('Session turn completed without producing a result')
    }
    return result
  }

  stream(prompt: string): AsyncIterable<StreamEvent> {
    return this.runSessionTurn(prompt)
  }

  abort(): void {
    this.abortController.abort()
    this.abortController = new AbortController()
  }

  get history(): readonly PublicMessageParam[] {
    return this.messages.map(m => ({
      role: m.role,
      content: m.content,
    })) as PublicMessageParam[]
  }

  // ─── Session Turn ───────────────────────────────────────────────────

  private async *runSessionTurn(prompt: string): AsyncGenerator<StreamEvent, void> {
    const startTime = Date.now()
    const maxTurns = this.config.maxTurns ?? 30

    this.messages.push({ role: 'user', content: prompt })

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

      if (this.abortController.signal.aborted) {
        this.abortController = new AbortController()
        break
      }

      yield { type: 'turn_start', turnNumber: turnCount }

      // ── Snip old messages (fast, zero-cost) ────────────────────────
      const snipResult = snipIfNeeded(this.messages)
      if (snipResult.snipped) {
        this.messages = snipResult.messages
      }

      // ── Microcompact tool results (fast, zero-cost) ────────────────
      const microResult = microcompact(this.messages)
      if (microResult.compressed > 0) {
        this.messages = microResult.messages
      }

      // ── Auto-compact check ──────────────────────────────────────────
      if (this.config.autoCompact !== false && lastUsage) {
        if (shouldAutoCompact(this.messages, this.config, lastUsage)) {
          const compacted = await compactMessages(
            this.messages,
            systemPrompt,
            this.client,
            this.config,
            this.abortController.signal,
          )
          if (compacted) {
            this.messages = compacted
            hasAttemptedCompact = true
          }
        }
      }

      // ── Call model (with retry + fallback) ─────────────────────────
      let modelResult: ModelCallResult | undefined
      let modelError: unknown = null
      const normalizedMessages = mergeConsecutiveUserMessages(this.messages)

      // Create streaming tool executor for this turn
      const streamingExecutor =
        useStreamingExecution && (this.config.tools?.length ?? 0) > 0
          ? new StreamingToolExecutor(
              this.toolMap,
              this.config,
              this.abortController.signal,
              this.messages,
              enableBudget,
            )
          : null

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
          const publicEvent = toPublicEvent(event, turnCount)
          if (publicEvent) yield publicEvent
          if (event.type === 'message_complete') modelResult = event.result
        }

        // Feed completed tool_use blocks to executor
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
        }
      } catch (error) {
        if (streamingExecutor) {
          for (const result of streamingExecutor.discard()) {
            // Discard on error
          }
        }

        if (error instanceof FallbackTriggeredError && this.config.fallbackModel) {
          this.activeModel = this.config.fallbackModel
          yield {
            type: 'error',
            error: new Error(
              `Switched to ${this.config.fallbackModel} due to high demand for ${this.config.model}`,
            ),
          }
          turnCount--
          continue
        }
        modelError = error
      }

      // ── 413 Recovery ──────────────────────────────────────────────
      if (modelError && isPromptTooLongError(modelError) && !hasAttemptedCompact) {
        const compacted = await compactMessages(
          this.messages,
          systemPrompt,
          this.client,
          this.config,
          this.abortController.signal,
        )
        if (compacted) {
          this.messages = compacted
          hasAttemptedCompact = true
          turnCount--
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

      lastUsage = modelResult.usage
      totalUsage.inputTokens += modelResult.usage.inputTokens
      totalUsage.outputTokens += modelResult.usage.outputTokens
      totalUsage.cacheCreationInputTokens += modelResult.usage.cacheCreationInputTokens
      totalUsage.cacheReadInputTokens += modelResult.usage.cacheReadInputTokens
      lastStopReason = modelResult.stopReason ?? 'end_turn'

      this.messages.push({
        role: 'assistant',
        content: modelResult.assistantContent as ContentBlockParam[],
      })

      // ── Max Output Escalation + Recovery ───────────────────────────
      if (lastStopReason === 'max_tokens') {
        // Path 1: Escalation — retry same messages at 64K
        // Skip if user explicitly set maxOutputTokens (they don't want auto-escalation)
        if (
          capEnabled &&
          maxOutputTokensOverride !== ESCALATED_MAX_TOKENS &&
          !this.config.maxOutputTokens
        ) {
          maxOutputTokensOverride = ESCALATED_MAX_TOKENS
          this.messages.pop()
          turnCount--
          continue
        }

        // Path 2: Recovery inject
        if (maxOutputRecoveryCount < maxRecoveryAttempts) {
          maxOutputRecoveryCount++
          if (capEnabled) {
            maxOutputTokensOverride = undefined
          }
          this.messages.push({ role: 'user', content: MAX_OUTPUT_RECOVERY_MESSAGE })
          continue
        }
      }

      // ── Extract tool_use blocks ────────────────────────────────────
      const toolUseBlocks = modelResult.assistantContent.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )

      if (toolUseBlocks.length > 0) {
        maxOutputRecoveryCount = 0
        if (capEnabled && !this.config.maxOutputTokens) {
          maxOutputTokensOverride = CAPPED_DEFAULT_MAX_TOKENS
        }
      }

      // ── No tool use → done ─────────────────────────────────────────
      if (toolUseBlocks.length === 0) {
        if (this.config.onTurnEnd) {
          const lastText = extractText(modelResult.assistantContent)
          const hookResult = await this.config.onTurnEnd({
            messages: this.messages,
            lastResponse: lastText,
          })
          if (hookResult?.continueWith) {
            this.messages.push({ role: 'user', content: hookResult.continueWith })
            continue
          }
        }

        yield { type: 'turn_end', stopReason: lastStopReason, turnNumber: turnCount }

        const finalText = extractText(modelResult.assistantContent)
        yield {
          type: 'result',
          result: {
            text: finalText,
            messages: this.messages.map(simplifyMessage),
            usage: totalUsage,
            stopReason: lastStopReason,
            numTurns: turnCount,
            durationMs: Date.now() - startTime,
          },
        }
        return
      }

      // ── Execute tools ──────────────────────────────────────────────
      yield { type: 'turn_end', stopReason: 'tool_use', turnNumber: turnCount }

      const allToolResults: ContentBlockParam[] = []

      if (streamingExecutor) {
        for await (const result of streamingExecutor.getRemainingResults()) {
          allToolResults.push(result.apiResult)
          yield result.event
        }
      } else {
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
              this.messages,
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
                this.messages,
                enableBudget,
              )
              for (const evt of events) yield evt
              allToolResults.push(apiResult)
            }
          }
        }
      }

      const budgetedResults = enableBudget ? applyMessageBudget(allToolResults) : allToolResults

      this.messages.push({ role: 'user', content: budgetedResults })
    }

    // Max turns reached
    const lastText = extractLastAssistantText(this.messages)
    yield {
      type: 'result',
      result: {
        text: lastText,
        messages: this.messages.map(simplifyMessage),
        usage: totalUsage,
        stopReason: `max_turns (${this.config.maxTurns ?? 30})`,
        numTurns: turnCount,
        durationMs: Date.now() - startTime,
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

function simplifyMessage(msg: MessageParam): PublicMessageParam {
  return { role: msg.role, content: msg.content } as PublicMessageParam
}
