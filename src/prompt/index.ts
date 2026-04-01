/**
 * prompt/index.ts — Public API for the prompt system.
 *
 * Architecture mirrors codenano:
 * - Section-based composition with static/dynamic boundary
 * - Priority-based assembly (override > agent > custom > default > append)
 * - Section caching for prompt cache optimization
 * - Environment injection
 * - Custom section support
 */

// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  SystemPrompt,
  SectionComputeFn,
  PromptSection,
  PromptPriority,
  EnvironmentInfo,
  OutputStyleConfig,
} from './types.js'

export {
  asSystemPrompt,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from './types.js'

// ─── Builder ───────────────────────────────────────────────────────────────
export {
  buildSystemPrompt,
  buildEffectiveSystemPrompt,
  simplePrompt,
  enhancePromptWithEnv,
} from './builder.js'

export type {
  PromptConfig,
  EffectivePromptOptions,
} from './builder.js'

// ─── Section System ────────────────────────────────────────────────────────
export {
  systemPromptSection,
  uncachedSection,
  resolveSections,
  clearSections,
  getSectionCacheSize,
} from './sections.js'

// ─── Individual Sections ───────────────────────────────────────────────────
export {
  getIntroSection,
  DEFAULT_IDENTITY,
  CLAUDE_CODE_IDENTITY,
  CLAUDE_CODE_SDK_IDENTITY,
} from './sections/intro.js'

export { getSystemSection } from './sections/system.js'
export { getTasksSection } from './sections/tasks.js'
export { getActionsSection } from './sections/actions.js'
export { getToolsSection } from './sections/tools.js'
export { getToneSection } from './sections/tone.js'
export { getEfficiencySection } from './sections/efficiency.js'
export {
  getEnvironmentSection,
  detectEnvironment,
} from './sections/environment.js'
export { getLanguageSection } from './sections/language.js'
export { getOutputStyleSection } from './sections/outputStyle.js'
export {
  customSection,
  getFunctionResultClearingSection,
  SUMMARIZE_TOOL_RESULTS_SECTION,
} from './sections/custom.js'

// ─── Utilities ─────────────────────────────────────────────────────────────
export { prependBullets, joinSections } from './utils.js'
