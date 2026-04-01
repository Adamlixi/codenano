/**
 * tool-budget.ts — Tool result size budgeting
 *
 * Simplified port of codenano's tool result budgeting system.
 * Original: src/utils/toolResultStorage.ts (1500+ lines, 2-tier system with disk persistence)
 *
 * SDK simplification:
 *   - Single-tier: truncate oversized results inline (no disk persistence)
 *   - Per-tool cap at DEFAULT_MAX_RESULT_SIZE_CHARS (50KB)
 *   - Per-message aggregate cap at MAX_RESULTS_PER_MESSAGE_CHARS (200KB)
 *   - Preview: first 2KB of truncated content
 *
 * codenano constants preserved:
 *   DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000
 *   MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000
 *   PREVIEW_SIZE_BYTES = 2_000
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max characters for a single tool result before truncation */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000

/** Max total characters for all tool results in one message */
export const MAX_RESULTS_PER_MESSAGE_CHARS = 200_000

/** Size of the preview shown for truncated results */
export const PREVIEW_SIZE_BYTES = 2_000

// ─── Per-Tool Truncation ─────────────────────────────────────────────────────

/**
 * Truncate a single tool result if it exceeds the size limit.
 *
 * Returns the original content if within budget, or a truncated preview
 * with size metadata.
 */
export function truncateToolResult(
  content: string,
  maxSize: number = DEFAULT_MAX_RESULT_SIZE_CHARS,
): string {
  if (content.length <= maxSize) return content

  const preview = generatePreview(content, PREVIEW_SIZE_BYTES)
  const sizeKB = (content.length / 1024).toFixed(1)

  return (
    `Output too large (${sizeKB} KB, limit ${(maxSize / 1024).toFixed(0)} KB). ` +
    `Showing first ${(PREVIEW_SIZE_BYTES / 1024).toFixed(1)} KB:\n\n` +
    `${preview}\n\n` +
    `...(${(content.length - PREVIEW_SIZE_BYTES).toLocaleString()} characters truncated)`
  )
}

// ─── Per-Message Budget ──────────────────────────────────────────────────────

/**
 * Represents a tool result in a message, used for budget enforcement.
 */
interface ToolResultEntry {
  /** Index in the content array */
  index: number
  /** The tool result content string */
  content: string
  /** Size in characters */
  size: number
}

/**
 * Apply aggregate budget to all tool results in a message.
 *
 * If the total size of all tool results exceeds MAX_RESULTS_PER_MESSAGE_CHARS,
 * the largest results are truncated until the total fits within budget.
 *
 * Returns a new content array with truncated results where needed.
 * Preserves the original array if within budget.
 */
export function applyMessageBudget(
  contentBlocks: any[],
  maxTotal: number = MAX_RESULTS_PER_MESSAGE_CHARS,
): any[] {
  // Collect tool_result entries with their sizes
  const entries: ToolResultEntry[] = []
  let totalSize = 0

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    if (block?.type === 'tool_result' && typeof block.content === 'string') {
      const size = block.content.length
      entries.push({ index: i, content: block.content, size })
      totalSize += size
    }
  }

  // Within budget — return as-is
  if (totalSize <= maxTotal) return contentBlocks

  // Sort by size (largest first) for truncation priority
  const sorted = [...entries].sort((a, b) => b.size - a.size)

  // Truncate largest entries until within budget
  const result = [...contentBlocks]
  let remaining = totalSize

  for (const entry of sorted) {
    if (remaining <= maxTotal) break

    // Calculate how much to keep: proportional share of budget
    const targetSize = Math.max(
      PREVIEW_SIZE_BYTES * 2, // Minimum useful size
      Math.floor(maxTotal / entries.length), // Fair share
    )

    if (entry.size > targetSize) {
      const truncated = truncateToolResult(entry.content, targetSize)
      result[entry.index] = {
        ...result[entry.index],
        content: truncated,
      }
      remaining -= entry.size - truncated.length
    }
  }

  return result
}

// ─── Preview Generator ───────────────────────────────────────────────────────

/**
 * Generate a preview of content, cutting at the nearest newline.
 * Mirrors codenano's generatePreview() in toolResultStorage.ts.
 */
function generatePreview(content: string, maxBytes: number): string {
  if (content.length <= maxBytes) return content

  // Try to cut at a newline boundary (at least 50% of limit)
  const minCut = Math.floor(maxBytes * 0.5)
  const searchRegion = content.slice(minCut, maxBytes)
  const lastNewline = searchRegion.lastIndexOf('\n')

  if (lastNewline !== -1) {
    return content.slice(0, minCut + lastNewline)
  }

  // No good newline boundary — hard cut
  return content.slice(0, maxBytes)
}
