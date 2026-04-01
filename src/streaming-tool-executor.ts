/**
 * streaming-tool-executor.ts — Execute tools while the model is still streaming.
 *
 * Ported from codenano's StreamingToolExecutor.ts (~531 lines → ~200 lines).
 * The key insight: when a tool_use content block finishes (content_block_stop),
 * its input JSON is complete even though the model may still be streaming more
 * blocks. We can start executing that tool immediately.
 *
 * Lifecycle:
 *   1. During streaming: addTool() queues and starts execution
 *   2. During streaming: getCompletedResults() yields any finished tools
 *   3. After streaming: getRemainingResults() waits for stragglers
 *
 * Concurrency rules (same as batch execution):
 *   - Concurrency-safe tools run in parallel
 *   - Non-safe tools run alone (exclusive access)
 *   - Order is preserved: non-safe tools block subsequent queued tools
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { ToolDef, AgentConfig, ToolContext, ToolOutput, StreamEvent } from './types.js'
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import { truncateToolResult } from './tool-budget.js'

// ─── Types ──────────────────────────────────────────────────────────────────

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

interface TrackedTool {
  id: string
  block: Anthropic.ToolUseBlock
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  apiResult?: ContentBlockParam
  event?: StreamEvent
}

export interface ToolExecutionResult {
  apiResult: ContentBlockParam
  event: StreamEvent
}

// ─── StreamingToolExecutor ──────────────────────────────────────────────────

export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolMap: Map<string, ToolDef>
  private config: AgentConfig
  private signal: AbortSignal
  private messages: MessageParam[]
  private enableBudget: boolean

  constructor(
    toolMap: Map<string, ToolDef>,
    config: AgentConfig,
    signal: AbortSignal,
    messages: MessageParam[],
    enableBudget: boolean = true,
  ) {
    this.toolMap = toolMap
    this.config = config
    this.signal = signal
    this.messages = messages
    this.enableBudget = enableBudget
  }

  /**
   * Add a completed tool_use block for execution.
   * Called when content_block_stop fires for a tool_use block.
   */
  addTool(block: Anthropic.ToolUseBlock): void {
    const tool = this.toolMap.get(block.name)

    let isConcurrencySafe = false
    if (tool) {
      const parsed = tool.input.safeParse(block.input)
      if (parsed.success) {
        if (typeof tool.isConcurrencySafe === 'function') {
          isConcurrencySafe = tool.isConcurrencySafe(parsed.data)
        } else if (typeof tool.isConcurrencySafe === 'boolean') {
          isConcurrencySafe = tool.isConcurrencySafe
        } else if (typeof tool.isReadOnly === 'function') {
          isConcurrencySafe = tool.isReadOnly(parsed.data)
        } else if (typeof tool.isReadOnly === 'boolean') {
          isConcurrencySafe = tool.isReadOnly
        }
      }
    }

    const tracked: TrackedTool = {
      id: block.id,
      block,
      status: 'queued',
      isConcurrencySafe,
    }

    this.tools.push(tracked)
    this.processQueue()
  }

  /**
   * Non-blocking: yield results for any tools that have completed.
   * Call this during the streaming loop.
   */
  *getCompletedResults(): Generator<ToolExecutionResult, void> {
    for (const tool of this.tools) {
      if (tool.status === 'completed' && tool.apiResult && tool.event) {
        tool.status = 'yielded'
        yield { apiResult: tool.apiResult, event: tool.event }
      }
    }
  }

  /**
   * Async: wait for all remaining tools to complete, yielding results as they finish.
   * Call this after the model stream ends.
   */
  async *getRemainingResults(): AsyncGenerator<ToolExecutionResult, void> {
    // First yield anything already completed
    for (const result of this.getCompletedResults()) {
      yield result
    }

    // Wait for executing/queued tools
    while (this.hasPending()) {
      // Wait for the next tool to complete
      const pending = this.tools.filter(t => t.status === 'executing' && t.promise)
      if (pending.length > 0) {
        await Promise.race(pending.map(t => t.promise!))
      }

      // Process queue in case waiting tools can now start
      this.processQueue()

      // Yield newly completed results
      for (const result of this.getCompletedResults()) {
        yield result
      }
    }
  }

  /**
   * Discard all pending/executing tools (e.g., on abort or stream fallback).
   * Returns synthetic error results for any non-yielded tools.
   */
  *discard(): Generator<ToolExecutionResult, void> {
    for (const tool of this.tools) {
      if (tool.status !== 'yielded') {
        const content = 'Tool execution cancelled'
        tool.status = 'yielded'
        yield {
          apiResult: {
            type: 'tool_result',
            tool_use_id: tool.id,
            content,
            is_error: true,
          } as ContentBlockParam,
          event: {
            type: 'tool_result',
            toolUseId: tool.id,
            output: content,
            isError: true,
          },
        }
      }
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private hasPending(): boolean {
    return this.tools.some(t => t.status === 'queued' || t.status === 'executing')
  }

  private canExecute(isConcurrencySafe: boolean): boolean {
    const executing = this.tools.filter(t => t.status === 'executing')
    if (executing.length === 0) return true
    return isConcurrencySafe && executing.every(t => t.isConcurrencySafe)
  }

  private processQueue(): void {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue
      if (!this.canExecute(tool.isConcurrencySafe)) break // Order matters — non-safe blocks subsequent
      this.startExecution(tool)
    }
  }

  private startExecution(tracked: TrackedTool): void {
    tracked.status = 'executing'
    tracked.promise = this.executeTool(tracked)
  }

  private async executeTool(tracked: TrackedTool): Promise<void> {
    const { block } = tracked
    const tool = this.toolMap.get(block.name)

    if (!tool) {
      this.setResult(tracked, `Error: Unknown tool "${block.name}"`, true)
      return
    }

    // Permission check
    if (this.config.canUseTool) {
      const decision = await this.config.canUseTool(
        block.name,
        block.input as Record<string, unknown>,
      )
      if (decision.behavior === 'deny') {
        this.setResult(
          tracked,
          `Permission denied: ${decision.message ?? 'Tool use not allowed'}`,
          true,
        )
        return
      }
    }

    // Validate input
    const parsed = tool.input.safeParse(block.input)
    if (!parsed.success) {
      this.setResult(tracked, `Input validation error: ${parsed.error.message}`, true)
      return
    }

    // Execute
    try {
      const context: ToolContext = { signal: this.signal, messages: this.messages }
      const rawOutput = await tool.execute(parsed.data, context)
      const output = normalizeToolOutput(rawOutput)

      const budgetedContent = this.enableBudget
        ? truncateToolResult(output.content)
        : output.content

      this.setResult(tracked, budgetedContent, output.isError ?? false)
    } catch (error) {
      this.setResult(
        tracked,
        `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
        true,
      )
    }
  }

  private setResult(tracked: TrackedTool, content: string, isError: boolean): void {
    tracked.status = 'completed'
    tracked.apiResult = {
      type: 'tool_result',
      tool_use_id: tracked.id,
      content,
      ...(isError && { is_error: true }),
    } as ContentBlockParam
    tracked.event = {
      type: 'tool_result',
      toolUseId: tracked.id,
      output: content,
      isError,
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeToolOutput(output: ToolOutput): { content: string; isError?: boolean } {
  if (typeof output === 'string') return { content: output }
  return output
}
