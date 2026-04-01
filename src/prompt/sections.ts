/**
 * prompt/sections.ts — Section caching and resolution
 *
 * Mirrors codenano's systemPromptSections.ts:
 * - systemPromptSection() — memoized section (cached until clear)
 * - uncachedSection() — volatile section (recomputes every turn)
 * - resolveSections() — parallel resolution of all sections
 * - clearSections() — invalidate cache (on /clear, /compact, etc.)
 */

import type { PromptSection, SectionComputeFn } from './types.js'

// ─── Section Cache ─────────────────────────────────────────────────────────

const sectionCache = new Map<string, string | null>()

// ─── Section Factories ─────────────────────────────────────────────────────

/**
 * Create a memoized system prompt section.
 * Computed once, then cached until clearSections() is called.
 */
export function systemPromptSection(name: string, compute: SectionComputeFn): PromptSection {
  return { name, compute, cacheBreak: false }
}

/**
 * Create a volatile system prompt section that recomputes every turn.
 * This WILL break the prompt cache when the value changes.
 *
 * @param name — Section name
 * @param compute — Compute function
 * @param _reason — Why cache-breaking is necessary (documentation only)
 */
export function uncachedSection(
  name: string,
  compute: SectionComputeFn,
  _reason: string,
): PromptSection {
  return { name, compute, cacheBreak: true }
}

// ─── Resolution ────────────────────────────────────────────────────────────

/**
 * Resolve all prompt sections in parallel, returning prompt strings.
 * Cached sections return their memoized value; volatile sections recompute.
 */
export async function resolveSections(sections: PromptSection[]): Promise<(string | null)[]> {
  return Promise.all(
    sections.map(async section => {
      // Return cached value for non-volatile sections
      if (!section.cacheBreak && sectionCache.has(section.name)) {
        return sectionCache.get(section.name) ?? null
      }

      // Compute and cache
      const value = await section.compute()
      sectionCache.set(section.name, value)
      return value
    }),
  )
}

// ─── Cache Management ──────────────────────────────────────────────────────

/** Clear all cached section values. Call on session reset or /clear. */
export function clearSections(): void {
  sectionCache.clear()
}

/** Get the current cache size (for diagnostics) */
export function getSectionCacheSize(): number {
  return sectionCache.size
}
