/**
 * Output style section — Custom output style injection.
 *
 * Mirrors Claude Code's getOutputStyleSection().
 */

import type { OutputStyleConfig } from '../types.js'

/**
 * Build the output style section.
 *
 * @param config — Output style configuration
 * @returns Section string or null if no custom style
 */
export function getOutputStyleSection(
  config: OutputStyleConfig | null | undefined,
): string | null {
  if (!config) return null

  return `# Output Style: ${config.name}
${config.prompt}`
}
