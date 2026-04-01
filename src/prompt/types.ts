/**
 * prompt/types.ts — Prompt system types
 *
 * Branded SystemPrompt type and section definitions.
 * Mirrors Claude Code's systemPromptType.ts + systemPromptSections.ts types.
 */

// ─── Branded SystemPrompt ──────────────────────────────────────────────────

/**
 * Branded type for system prompt arrays.
 * Prevents accidentally passing raw string[] where a system prompt is expected.
 */
export type SystemPrompt = readonly string[] & {
  readonly __brand: 'SystemPrompt'
}

/** Wrap a string array as a branded SystemPrompt */
export function asSystemPrompt(value: readonly string[]): SystemPrompt {
  return value as SystemPrompt
}

// ─── Prompt Section ────────────────────────────────────────────────────────

/** Function that computes a prompt section's content */
export type SectionComputeFn = () => string | null | Promise<string | null>

/** A named, optionally cached section of the system prompt */
export interface PromptSection {
  /** Unique section name (used as cache key) */
  name: string

  /** Compute function that produces the section content */
  compute: SectionComputeFn

  /**
   * If true, this section recomputes every turn (breaking prompt cache).
   * If false (default), the section is memoized until clearSections() is called.
   */
  cacheBreak: boolean
}

// ─── Prompt Priority ───────────────────────────────────────────────────────

/**
 * Priority levels for system prompt assembly.
 *
 * Mirrors Claude Code's buildEffectiveSystemPrompt() priority chain:
 *   override > agent > custom > default > append
 */
export type PromptPriority =
  | 'override'   // Replaces everything (e.g. loop mode)
  | 'agent'      // Agent-specific prompt (replaces or appends to default)
  | 'custom'     // User-provided via --system-prompt or config
  | 'default'    // Standard prompt built from sections
  | 'append'     // Always added at end (unless override is set)

// ─── Environment Info ──────────────────────────────────────────────────────

/** Environment context injected into the system prompt */
export interface EnvironmentInfo {
  /** Primary working directory */
  cwd?: string

  /** Whether the working directory is a git repository */
  isGitRepo?: boolean

  /** Additional working directories */
  additionalWorkingDirectories?: string[]

  /** Operating system platform */
  platform?: string

  /** Shell name (e.g. 'zsh', 'bash') */
  shell?: string

  /** OS version string */
  osVersion?: string

  /** Model's knowledge cutoff date */
  knowledgeCutoff?: string
}

// ─── Output Style ──────────────────────────────────────────────────────────

/** Custom output style configuration */
export interface OutputStyleConfig {
  /** Style name */
  name: string

  /** Human-readable description */
  description: string

  /** Prompt instructions for this style */
  prompt: string

  /**
   * If true, the standard coding instructions (Doing tasks section)
   * are kept alongside the output style prompt.
   */
  keepCodingInstructions?: boolean
}

// ─── Dynamic Boundary ──────────────────────────────────────────────────────

/**
 * Boundary marker separating static (cross-org cacheable) content
 * from dynamic (session-specific) content.
 *
 * Everything BEFORE this marker in the system prompt array can use
 * scope: 'global' for API-level prompt caching.
 * Everything AFTER contains user/session-specific content.
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
