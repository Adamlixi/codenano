/**
 * prompt/utils.ts — Shared prompt formatting utilities.
 *
 * Mirrors codenano's prependBullets() and other prompt helpers.
 */

/**
 * Format items as a bulleted list with nested sub-items.
 * String items get a top-level bullet; string[] items get indented sub-bullets.
 *
 * Mirrors codenano's prependBullets().
 */
export function prependBullets(items: Array<string | string[]>): string[] {
  return items.flatMap(item =>
    Array.isArray(item)
      ? item.map(subitem => `  - ${subitem}`)
      : [` - ${item}`],
  )
}

/**
 * Join non-null sections with double newlines.
 * Filters out null/undefined/empty entries.
 */
export function joinSections(sections: (string | null | undefined)[]): string {
  return sections
    .filter((s): s is string => s != null && s.length > 0)
    .join('\n\n')
}
