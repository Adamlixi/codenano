/**
 * tool-executor.ts — Shared tool execution logic
 *
 * Extracted from agent.ts and session.ts to eliminate code duplication.
 * Handles tool batching, concurrency, and execution.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { AgentConfig, ToolDef, ToolContext, StreamEvent } from './types.js'
import { truncateToolResult } from './tool-budget.js'

const MAX_TOOL_CONCURRENCY = 10

// ─── Types ──────────────────────────────────────────────────────────────────

interface ToolBatch {
  isConcurrencySafe: boolean
  blocks: Anthropic.ToolUseBlock[]
}

interface ToolExecResult {
  apiResult: ContentBlockParam
  event: StreamEvent
}

interface SingleToolExecResult {
  apiResult: ContentBlockParam
  events: StreamEvent[]
}

// ─── Tool Batching ──────────────────────────────────────────────────────────

/**
 * Partition tool_use blocks into batches for concurrent/sequential execution.
 */
export function partitionToolCalls(
  toolUseBlocks: Anthropic.ToolUseBlock[],
  toolMap: Map<string, ToolDef>,
): ToolBatch[] {
  return toolUseBlocks.reduce<ToolBatch[]>((batches, toolUse) => {
    const tool = toolMap.get(toolUse.name)

    let isConcurrencySafe = false
    if (tool) {
      const parsed = tool.input.safeParse(toolUse.input)
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

    const lastBatch = batches[batches.length - 1]
    if (isConcurrencySafe && lastBatch?.isConcurrencySafe) {
      lastBatch.blocks.push(toolUse)
    } else {
      batches.push({ isConcurrencySafe, blocks: [toolUse] })
    }

    return batches
  }, [])
}

// ─── Single Tool Execution ──────────────────────────────────────────────────

/**
 * Execute a single tool — handles lookup, permission, validation, execution.
 */
export async function executeSingleTool(
  toolUse: Anthropic.ToolUseBlock,
  toolMap: Map<string, ToolDef>,
  config: AgentConfig,
  signal: AbortSignal,
  messages: MessageParam[],
  enableBudget: boolean = true,
): Promise<SingleToolExecResult> {
  const events: StreamEvent[] = []
  const tool = toolMap.get(toolUse.name)

  if (!tool) {
    const content = `Error: Unknown tool "${toolUse.name}"`
    events.push({ type: 'tool_result', toolUseId: toolUse.id, output: content, isError: true })
    return {
      apiResult: {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content,
        is_error: true,
      } as ContentBlockParam,
      events,
    }
  }

  // Permission check
  if (config.canUseTool) {
    const decision = await config.canUseTool(toolUse.name, toolUse.input as Record<string, unknown>)
    if (decision.behavior === 'deny') {
      const content = `Permission denied: ${decision.message ?? 'Tool use not allowed'}`
      events.push({ type: 'tool_result', toolUseId: toolUse.id, output: content, isError: true })
      return {
        apiResult: {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          is_error: true,
        } as ContentBlockParam,
        events,
      }
    }
  }

  // Validate input
  const parsed = tool.input.safeParse(toolUse.input)
  if (!parsed.success) {
    const content = `Input validation error: ${parsed.error.message}`
    events.push({ type: 'tool_result', toolUseId: toolUse.id, output: content, isError: true })
    return {
      apiResult: {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content,
        is_error: true,
      } as ContentBlockParam,
      events,
    }
  }

  // Emit tool_use event
  events.push({
    type: 'tool_use',
    toolName: toolUse.name,
    toolUseId: toolUse.id,
    input: parsed.data,
  })

  // Execute
  try {
    const context: ToolContext = { signal, messages }
    const rawOutput = await tool.execute(parsed.data, context)
    const output = normalizeToolOutput(rawOutput)

    const budgetedContent = enableBudget ? truncateToolResult(output.content) : output.content

    events.push({
      type: 'tool_result',
      toolUseId: toolUse.id,
      output: budgetedContent,
      isError: output.isError ?? false,
    })
    return {
      apiResult: {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: budgetedContent,
        ...(output.isError && { is_error: true }),
      } as ContentBlockParam,
      events,
    }
  } catch (error) {
    const content = `Tool execution error: ${error instanceof Error ? error.message : String(error)}`
    events.push({ type: 'tool_result', toolUseId: toolUse.id, output: content, isError: true })
    return {
      apiResult: {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content,
        is_error: true,
      } as ContentBlockParam,
      events,
    }
  }
}

// ─── Batch Concurrent Execution ─────────────────────────────────────────────

/**
 * Execute a batch of tools concurrently with a concurrency cap.
 */
export async function executeBatchConcurrently(
  blocks: Anthropic.ToolUseBlock[],
  toolMap: Map<string, ToolDef>,
  config: AgentConfig,
  signal: AbortSignal,
  messages: MessageParam[],
  concurrencyCap: number = MAX_TOOL_CONCURRENCY,
  enableBudget: boolean = true,
): Promise<ToolExecResult[]> {
  const results: ToolExecResult[] = new Array(blocks.length)

  const runOne = async (idx: number): Promise<void> => {
    const toolUse = blocks[idx]!
    const tool = toolMap.get(toolUse.name)

    if (!tool) {
      const content = `Error: Unknown tool "${toolUse.name}"`
      results[idx] = {
        apiResult: {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          is_error: true,
        } as ContentBlockParam,
        event: { type: 'tool_result', toolUseId: toolUse.id, output: content, isError: true },
      }
      return
    }

    const parsed = tool.input.safeParse(toolUse.input)
    if (!parsed.success) {
      const content = `Input validation error: ${parsed.error.message}`
      results[idx] = {
        apiResult: {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          is_error: true,
        } as ContentBlockParam,
        event: { type: 'tool_result', toolUseId: toolUse.id, output: content, isError: true },
      }
      return
    }

    try {
      const context: ToolContext = { signal, messages }
      const rawOutput = await tool.execute(parsed.data, context)
      const output = normalizeToolOutput(rawOutput)

      const budgetedContent = enableBudget ? truncateToolResult(output.content) : output.content

      results[idx] = {
        apiResult: {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: budgetedContent,
          ...(output.isError && { is_error: true }),
        } as ContentBlockParam,
        event: {
          type: 'tool_result',
          toolUseId: toolUse.id,
          output: budgetedContent,
          isError: output.isError ?? false,
        },
      }
    } catch (error) {
      const content = `Tool execution error: ${error instanceof Error ? error.message : String(error)}`
      results[idx] = {
        apiResult: {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          is_error: true,
        } as ContentBlockParam,
        event: { type: 'tool_result', toolUseId: toolUse.id, output: content, isError: true },
      }
    }
  }

  // Batch execution with concurrency cap
  let nextIndex = 0
  while (nextIndex < blocks.length) {
    const batch: Promise<void>[] = []
    const batchSize = Math.min(concurrencyCap, blocks.length - nextIndex)
    for (let i = 0; i < batchSize; i++) {
      batch.push(runOne(nextIndex++))
    }
    await Promise.all(batch)
  }

  return results
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeToolOutput(output: string | { content: string; isError?: boolean }): {
  content: string
  isError?: boolean
} {
  if (typeof output === 'string') return { content: output }
  return output
}
