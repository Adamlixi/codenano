/**
 * prompt/builder.ts — System prompt assembly and priority resolution.
 *
 * Mirrors codenano's architecture:
 * - getSystemPrompt() → builds sections array from config
 * - buildEffectiveSystemPrompt() → applies priority chain
 *
 * The builder supports:
 * 1. Section-based composition (static + dynamic boundary)
 * 2. Priority chain: override > agent > custom > default > append
 * 3. Section caching via systemPromptSection()
 * 4. Custom section injection
 */

import type { SystemPrompt, OutputStyleConfig, EnvironmentInfo, PromptSection } from './types.js'
import { asSystemPrompt, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './types.js'
import { systemPromptSection, uncachedSection, resolveSections } from './sections.js'
import { getIntroSection, DEFAULT_IDENTITY } from './sections/intro.js'
import { getSystemSection } from './sections/system.js'
import { getTasksSection } from './sections/tasks.js'
import { getActionsSection } from './sections/actions.js'
import { getToolsSection } from './sections/tools.js'
import { getToneSection } from './sections/tone.js'
import { getEfficiencySection } from './sections/efficiency.js'
import { getEnvironmentSection } from './sections/environment.js'
import { getLanguageSection } from './sections/language.js'
import { getOutputStyleSection } from './sections/outputStyle.js'
import { SUMMARIZE_TOOL_RESULTS_SECTION } from './sections/custom.js'
import type { ToolDef } from '../types.js'

// ─── Prompt Config ─────────────────────────────────────────────────────────

/** Configuration for building a system prompt */
export interface PromptConfig {
  /** Agent identity string (default: SDK agent identity) */
  identity?: string

  /** Model ID being used */
  model: string

  /** Tools available to the agent */
  tools?: ToolDef[]

  /** Output style configuration */
  outputStyle?: OutputStyleConfig | null

  /** Language preference (e.g. "Chinese", "Japanese") */
  language?: string

  /** Environment info to inject */
  environment?: EnvironmentInfo

  /** Whether to use prompt caching boundary (default: true) */
  useCacheBoundary?: boolean

  /** Additional custom sections (injected after dynamic boundary) */
  customSections?: PromptSection[]

  /** Raw string sections to append (for simple use cases) */
  appendSections?: string[]
}

// ─── Main Builder ──────────────────────────────────────────────────────────

/**
 * Build a complete system prompt from configuration.
 *
 * Mirrors codenano's getSystemPrompt() architecture:
 * - Static sections (before boundary) are cross-org cacheable
 * - Dynamic sections (after boundary) are session-specific
 *
 * @example
 * ```typescript
 * const prompt = await buildSystemPrompt({
 *   model: 'claude-sonnet-4-6',
 *   tools: [readFile, writeFile],
 *   language: 'Chinese',
 *   environment: { cwd: '/project', platform: 'darwin' },
 * })
 * ```
 */
export async function buildSystemPrompt(config: PromptConfig): Promise<SystemPrompt> {
  const {
    identity = DEFAULT_IDENTITY,
    model,
    tools = [],
    outputStyle = null,
    language,
    environment,
    useCacheBoundary = true,
    customSections = [],
    appendSections = [],
  } = config

  // ── Static sections (cacheable across orgs) ────────────────────────
  const staticSections: (string | null)[] = [
    getIntroSection(identity, outputStyle),
    getSystemSection(),
    // Keep task instructions unless output style explicitly replaces them
    outputStyle === null || outputStyle.keepCodingInstructions === true ? getTasksSection() : null,
    getActionsSection(),
    tools.length > 0 ? getToolsSection(tools) : null,
    getToneSection(),
    getEfficiencySection(),
  ]

  // ── Dynamic sections (session-specific, memoized) ──────────────────
  const dynamicSectionDefs: PromptSection[] = [
    systemPromptSection('env_info', () => getEnvironmentSection(model, environment)),
    systemPromptSection('language', () => getLanguageSection(language)),
    systemPromptSection('output_style', () => getOutputStyleSection(outputStyle)),
    systemPromptSection('summarize_tool_results', () => SUMMARIZE_TOOL_RESULTS_SECTION),
    // Include any developer-provided custom sections
    ...customSections,
  ]

  const resolvedDynamic = await resolveSections(dynamicSectionDefs)

  // ── Assemble ───────────────────────────────────────────────────────
  return asSystemPrompt(
    [
      // Static content (cacheable)
      ...staticSections,
      // Cache boundary marker
      ...(useCacheBoundary ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),
      // Dynamic content (session-specific)
      ...resolvedDynamic,
      // Raw append sections
      ...appendSections,
    ].filter((s): s is string => s !== null),
  )
}

// ─── Priority-based Assembly ───────────────────────────────────────────────

/** Options for buildEffectiveSystemPrompt */
export interface EffectivePromptOptions {
  /** Override prompt — replaces everything if set */
  overridePrompt?: string | null

  /** Agent-specific prompt — replaces default unless in proactive mode */
  agentPrompt?: string | null

  /** Custom prompt via --system-prompt flag or config */
  customPrompt?: string | null

  /** Default prompt — the standard prompt built from sections */
  defaultPrompt: string[]

  /** Append prompt — always added at end (unless override is set) */
  appendPrompt?: string | null

  /** If true, agent prompt is appended to default instead of replacing */
  agentAppendMode?: boolean
}

/**
 * Build the effective system prompt using priority chain.
 *
 * Priority order (highest to lowest):
 * 0. Override — replaces everything
 * 1. Agent — replaces default (or appends in agentAppendMode)
 * 2. Custom — replaces default
 * 3. Default — standard prompt from sections
 * 4. Append — always added at end
 *
 * Mirrors codenano's buildEffectiveSystemPrompt().
 */
export function buildEffectiveSystemPrompt(options: EffectivePromptOptions): SystemPrompt {
  const {
    overridePrompt,
    agentPrompt,
    customPrompt,
    defaultPrompt,
    appendPrompt,
    agentAppendMode = false,
  } = options

  // 0. Override replaces everything
  if (overridePrompt) {
    return asSystemPrompt([overridePrompt])
  }

  // 1. Agent prompt — append or replace
  if (agentPrompt) {
    if (agentAppendMode) {
      return asSystemPrompt([
        ...defaultPrompt,
        `\n# Custom Agent Instructions\n${agentPrompt}`,
        ...(appendPrompt ? [appendPrompt] : []),
      ])
    }
    return asSystemPrompt([agentPrompt, ...(appendPrompt ? [appendPrompt] : [])])
  }

  // 2. Custom prompt replaces default
  if (customPrompt) {
    return asSystemPrompt([customPrompt, ...(appendPrompt ? [appendPrompt] : [])])
  }

  // 3. Default prompt + optional append
  return asSystemPrompt([...defaultPrompt, ...(appendPrompt ? [appendPrompt] : [])])
}

// ─── Convenience: Simple String Prompt ─────────────────────────────────────

/**
 * Build a minimal system prompt from a plain string.
 * For simple use cases where section-based composition isn't needed.
 */
export function simplePrompt(prompt: string): SystemPrompt {
  return asSystemPrompt([prompt])
}

/**
 * Enhance an existing system prompt with environment details.
 * Useful for subagent prompts that need env context.
 *
 * Mirrors codenano's enhanceSystemPromptWithEnvDetails().
 */
export function enhancePromptWithEnv(
  existingPrompt: string[],
  model: string,
  env?: EnvironmentInfo,
): SystemPrompt {
  const notes = `Notes:
- In your final response, share file paths (always absolute, never relative) that are relevant to the task.
- For clear communication with the user, avoid using emojis.`

  const envInfo = getEnvironmentSection(model, env)

  return asSystemPrompt([...existingPrompt, notes, envInfo])
}
