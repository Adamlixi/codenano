/**
 * Tone and style section — Communication guidelines.
 *
 * Mirrors Claude Code's getSimpleToneAndStyleSection().
 */

import { prependBullets } from '../utils.js'

/** Build the "Tone and style" section */
export function getToneSection(): string {
  const items = [
    `Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.`,
    `Your responses should be short and concise.`,
    `When referencing specific functions or pieces of code include the pattern file_path:line_number to allow the user to easily navigate to the source code location.`,
    `Do not use a colon before tool calls. Your tool calls may not be shown directly in the output, so text like "Let me read the file:" followed by a read tool call should just be "Let me read the file." with a period.`,
  ]

  return ['# Tone and style', ...prependBullets(items)].join('\n')
}
