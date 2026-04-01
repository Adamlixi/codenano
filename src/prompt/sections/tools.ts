/**
 * Tools section — Guidance for using available tools.
 *
 * Mirrors Claude Code's getUsingYourToolsSection().
 * Generates tool usage instructions based on which tools are available.
 */

import type { ToolDef } from '../../types.js'
import { prependBullets } from '../utils.js'

/**
 * Build the "Using your tools" section based on available tools.
 *
 * @param tools — Array of tool definitions available to the agent
 * @param options — Additional configuration
 */
export function getToolsSection(
  tools: ToolDef[],
  options?: {
    /** Custom tool usage guidelines (appended to default items) */
    additionalGuidance?: string[]
    /** Whether to include parallel tool call guidance (default: true) */
    parallelCallGuidance?: boolean
  },
): string {
  const toolNames = new Set(tools.map(t => t.name))

  const items: (string | string[])[] = []

  // Tool-specific guidance based on what's available
  const toolHints: string[] = []

  if (toolNames.has('Read')) {
    toolHints.push('To read files use Read instead of cat, head, tail, or sed')
  }
  if (toolNames.has('Edit')) {
    toolHints.push('To edit files use Edit instead of sed or awk')
  }
  if (toolNames.has('Write')) {
    toolHints.push('To create files use Write instead of cat with heredoc or echo redirection')
  }
  if (toolNames.has('Glob')) {
    toolHints.push('To search for files use Glob instead of find or ls')
  }
  if (toolNames.has('Grep')) {
    toolHints.push('To search the content of files, use Grep instead of grep or rg')
  }

  if (toolNames.has('Bash') && toolHints.length > 0) {
    items.push(
      `Do NOT use Bash to run commands when a relevant dedicated tool is provided. Using dedicated tools allows the user to better understand and review your work:`,
    )
    items.push(toolHints)
    items.push(
      `Reserve using Bash exclusively for system commands and terminal operations that require shell execution.`,
    )
  }

  // Parallel tool call guidance
  if (options?.parallelCallGuidance !== false) {
    items.push(
      `You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency.`,
    )
  }

  // Additional custom guidance
  if (options?.additionalGuidance) {
    items.push(...options.additionalGuidance)
  }

  if (items.length === 0) return ''

  return ['# Using your tools', ...prependBullets(items)].join('\n')
}
