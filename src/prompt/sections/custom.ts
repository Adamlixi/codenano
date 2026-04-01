/**
 * Custom sections — Developer-defined prompt sections.
 *
 * Allows SDK users to inject arbitrary sections into the prompt,
 * similar to how codenano injects MCP instructions, scratchpad
 * instructions, memory, etc.
 */

/**
 * Wrap a custom prompt string as a named section.
 *
 * @param title — Section heading (e.g. "Project Context", "Memory")
 * @param content — Section body content
 * @returns Formatted section string
 */
export function customSection(title: string, content: string): string {
  return `# ${title}\n\n${content}`
}

/**
 * Build a "Function Result Clearing" section (if applicable).
 * Informs the model that old tool results may be cleared from context.
 *
 * Mirrors codenano's getFunctionResultClearingSection().
 *
 * @param keepRecent — Number of recent results to keep
 */
export function getFunctionResultClearingSection(keepRecent: number): string {
  return `# Function Result Clearing

Old tool results will be automatically cleared from context to free up space. The ${keepRecent} most recent results are always kept.`
}

/**
 * Standard reminder about preserving important information from tool results.
 * Mirrors codenano's SUMMARIZE_TOOL_RESULTS_SECTION.
 */
export const SUMMARIZE_TOOL_RESULTS_SECTION = `When working with tool results, write down any important information you might need later in your response, as the original tool result may be cleared later.`
