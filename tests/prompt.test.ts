/**
 * Prompt system tests — verifies section building, caching, and priority assembly.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Builder
  buildSystemPrompt,
  buildEffectiveSystemPrompt,
  simplePrompt,
  enhancePromptWithEnv,

  // Section system
  systemPromptSection,
  uncachedSection,
  resolveSections,
  clearSections,

  // Individual sections
  getIntroSection,
  getSystemSection,
  getTasksSection,
  getActionsSection,
  getToolsSection,
  getToneSection,
  getEfficiencySection,
  getEnvironmentSection,
  getLanguageSection,
  getOutputStyleSection,
  customSection,

  // Constants
  DEFAULT_IDENTITY,
  CLAUDE_CODE_IDENTITY,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  SUMMARIZE_TOOL_RESULTS_SECTION,

  // Utils
  prependBullets,
  joinSections,
} from '../src/prompt/index.js'
import { z } from 'zod'
import { defineTool } from '../src/tool-builder.js'

// ─── Section Builders ──────────────────────────────────────────────────────

describe('Individual Sections', () => {
  it('getIntroSection — default', () => {
    const section = getIntroSection(DEFAULT_IDENTITY)
    expect(section).toContain('Claude agent')
    expect(section).toContain('interactive agent')
    expect(section).toContain('software engineering tasks')
  })

  it('getIntroSection — with output style', () => {
    const section = getIntroSection(DEFAULT_IDENTITY, {
      name: 'Explanatory',
      description: 'Explains things',
      prompt: 'Be explanatory',
    })
    expect(section).toContain('Output Style')
    expect(section).not.toContain('software engineering tasks')
  })

  it('getIntroSection — custom identity', () => {
    const section = getIntroSection('You are a database expert.')
    expect(section).toContain('database expert')
  })

  it('getSystemSection — contains core items', () => {
    const section = getSystemSection()
    expect(section).toContain('# System')
    expect(section).toContain('tool use')
    expect(section).toContain('permission')
    expect(section).toContain('prompt injection')
    expect(section).toContain('hooks')
    expect(section).toContain('compress')
  })

  it('getSystemSection — without hooks', () => {
    const section = getSystemSection({ hasHooks: false })
    expect(section).not.toContain('hooks')
  })

  it('getTasksSection — contains coding guidance', () => {
    const section = getTasksSection()
    expect(section).toContain('# Doing tasks')
    expect(section).toContain('security vulnerabilities')
    expect(section).toContain('OWASP')
    expect(section).toContain("Don't add features")
  })

  it('getActionsSection — contains risk guidance', () => {
    const section = getActionsSection()
    expect(section).toContain('reversibility')
    expect(section).toContain('blast radius')
    expect(section).toContain('Destructive operations')
  })

  it('getToolsSection — generates tool-specific guidance', () => {
    const tools = [
      defineTool({
        name: 'Read',
        description: 'Read a file',
        input: z.object({ path: z.string() }),
        execute: async () => 'content',
      }),
      defineTool({
        name: 'Bash',
        description: 'Run a command',
        input: z.object({ command: z.string() }),
        execute: async () => 'output',
      }),
    ]
    const section = getToolsSection(tools)
    expect(section).toContain('# Using your tools')
    expect(section).toContain('Read instead of cat')
    expect(section).toContain('parallel')
  })

  it('getToolsSection — still has parallel guidance with no tools', () => {
    const section = getToolsSection([])
    // No tool-specific hints, but parallel call guidance still present
    expect(section).toContain('parallel')
    expect(section).not.toContain('Read instead of cat')
  })

  it('getToneSection — contains style rules', () => {
    const section = getToneSection()
    expect(section).toContain('# Tone and style')
    expect(section).toContain('emojis')
    expect(section).toContain('file_path:line_number')
  })

  it('getEfficiencySection — contains conciseness guidance', () => {
    const section = getEfficiencySection()
    expect(section).toContain('# Output efficiency')
    expect(section).toContain('straight to the point')
    expect(section).toContain('concise')
  })

  it('getEnvironmentSection — includes env details', () => {
    const section = getEnvironmentSection('claude-sonnet-4-6', {
      cwd: '/Users/test/project',
      isGitRepo: true,
      platform: 'darwin',
      shell: 'zsh',
      knowledgeCutoff: 'August 2025',
    })
    expect(section).toContain('# Environment')
    expect(section).toContain('/Users/test/project')
    expect(section).toContain('true')
    expect(section).toContain('darwin')
    expect(section).toContain('zsh')
    expect(section).toContain('claude-sonnet-4-6')
    expect(section).toContain('August 2025')
  })

  it('getLanguageSection — returns null when no language', () => {
    expect(getLanguageSection(undefined)).toBeNull()
  })

  it('getLanguageSection — returns section with language', () => {
    const section = getLanguageSection('Chinese')
    expect(section).toContain('# Language')
    expect(section).toContain('Chinese')
  })

  it('getOutputStyleSection — returns null when no config', () => {
    expect(getOutputStyleSection(null)).toBeNull()
  })

  it('getOutputStyleSection — returns formatted section', () => {
    const section = getOutputStyleSection({
      name: 'Verbose',
      description: 'Be verbose',
      prompt: 'Explain everything in detail.',
    })
    expect(section).toContain('# Output Style: Verbose')
    expect(section).toContain('Explain everything in detail.')
  })

  it('customSection — wraps content with title', () => {
    const section = customSection('Memory', 'Remember X and Y.')
    expect(section).toBe('# Memory\n\nRemember X and Y.')
  })
})

// ─── Section Caching ───────────────────────────────────────────────────────

describe('Section Caching', () => {
  beforeEach(() => {
    clearSections()
  })

  it('systemPromptSection — caches result', async () => {
    let callCount = 0
    const section = systemPromptSection('test_cached', () => {
      callCount++
      return `value_${callCount}`
    })

    const results1 = await resolveSections([section])
    const results2 = await resolveSections([section])

    expect(callCount).toBe(1)
    expect(results1[0]).toBe('value_1')
    expect(results2[0]).toBe('value_1') // cached
  })

  it('uncachedSection — recomputes every time', async () => {
    let callCount = 0
    const section = uncachedSection('test_volatile', () => {
      callCount++
      return `value_${callCount}`
    }, 'test reason')

    const results1 = await resolveSections([section])
    const results2 = await resolveSections([section])

    expect(callCount).toBe(2)
    expect(results1[0]).toBe('value_1')
    expect(results2[0]).toBe('value_2')
  })

  it('clearSections — invalidates cache', async () => {
    let callCount = 0
    const section = systemPromptSection('test_clear', () => {
      callCount++
      return `value_${callCount}`
    })

    await resolveSections([section])
    expect(callCount).toBe(1)

    clearSections()

    await resolveSections([section])
    expect(callCount).toBe(2)
  })

  it('resolveSections — handles async compute', async () => {
    const section = systemPromptSection('test_async', async () => {
      return 'async_value'
    })

    const results = await resolveSections([section])
    expect(results[0]).toBe('async_value')
  })

  it('resolveSections — handles null returns', async () => {
    const section = systemPromptSection('test_null', () => null)
    const results = await resolveSections([section])
    expect(results[0]).toBeNull()
  })
})

// ─── Priority Assembly ─────────────────────────────────────────────────────

describe('buildEffectiveSystemPrompt', () => {
  const defaultPrompt = ['Default section 1', 'Default section 2']

  it('uses default when nothing else specified', () => {
    const result = buildEffectiveSystemPrompt({ defaultPrompt })
    expect([...result]).toEqual(defaultPrompt)
  })

  it('override replaces everything', () => {
    const result = buildEffectiveSystemPrompt({
      defaultPrompt,
      overridePrompt: 'Override only',
      customPrompt: 'Custom',
      appendPrompt: 'Append',
    })
    expect([...result]).toEqual(['Override only'])
  })

  it('agent prompt replaces default', () => {
    const result = buildEffectiveSystemPrompt({
      defaultPrompt,
      agentPrompt: 'Agent prompt',
    })
    expect([...result]).toEqual(['Agent prompt'])
  })

  it('agent prompt appends in agentAppendMode', () => {
    const result = buildEffectiveSystemPrompt({
      defaultPrompt,
      agentPrompt: 'Agent extra',
      agentAppendMode: true,
    })
    expect([...result]).toContain('Default section 1')
    expect([...result].some(s => s.includes('Agent extra'))).toBe(true)
  })

  it('custom prompt replaces default', () => {
    const result = buildEffectiveSystemPrompt({
      defaultPrompt,
      customPrompt: 'Custom prompt',
    })
    expect([...result]).toEqual(['Custom prompt'])
  })

  it('append is added at end', () => {
    const result = buildEffectiveSystemPrompt({
      defaultPrompt,
      appendPrompt: 'Always appended',
    })
    const parts = [...result]
    expect(parts[parts.length - 1]).toBe('Always appended')
  })

  it('append works with custom prompt', () => {
    const result = buildEffectiveSystemPrompt({
      defaultPrompt,
      customPrompt: 'Custom',
      appendPrompt: 'Appended',
    })
    expect([...result]).toEqual(['Custom', 'Appended'])
  })
})

// ─── Full Builder ──────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('produces a complete prompt with all sections', async () => {
    clearSections()
    const prompt = await buildSystemPrompt({
      model: 'claude-sonnet-4-6',
      environment: { cwd: '/test', platform: 'darwin' },
    })

    const joined = [...prompt].join('\n')
    // Should contain all major sections
    expect(joined).toContain('interactive agent')
    expect(joined).toContain('# System')
    expect(joined).toContain('# Doing tasks')
    expect(joined).toContain('# Executing actions with care')
    expect(joined).toContain('# Tone and style')
    expect(joined).toContain('# Output efficiency')
    expect(joined).toContain('# Environment')
    expect(joined).toContain('claude-sonnet-4-6')
  })

  it('includes language section when specified', async () => {
    clearSections()
    const prompt = await buildSystemPrompt({
      model: 'claude-sonnet-4-6',
      language: 'Japanese',
    })
    const joined = [...prompt].join('\n')
    expect(joined).toContain('Japanese')
  })

  it('includes custom identity', async () => {
    clearSections()
    const prompt = await buildSystemPrompt({
      model: 'claude-sonnet-4-6',
      identity: 'You are a security auditor.',
    })
    const joined = [...prompt].join('\n')
    expect(joined).toContain('security auditor')
  })

  it('includes dynamic boundary when enabled', async () => {
    clearSections()
    const prompt = await buildSystemPrompt({
      model: 'claude-sonnet-4-6',
      useCacheBoundary: true,
    })
    expect([...prompt]).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  })

  it('excludes dynamic boundary when disabled', async () => {
    clearSections()
    const prompt = await buildSystemPrompt({
      model: 'claude-sonnet-4-6',
      useCacheBoundary: false,
    })
    expect([...prompt]).not.toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  })

  it('supports custom sections', async () => {
    clearSections()
    const prompt = await buildSystemPrompt({
      model: 'claude-sonnet-4-6',
      customSections: [
        systemPromptSection('memory', () => '# Memory\n\nRemember: X = 42'),
      ],
    })
    const joined = [...prompt].join('\n')
    expect(joined).toContain('Remember: X = 42')
  })
})

// ─── Convenience Functions ─────────────────────────────────────────────────

describe('Convenience functions', () => {
  it('simplePrompt — wraps string', () => {
    const prompt = simplePrompt('Just do what I say.')
    expect([...prompt]).toEqual(['Just do what I say.'])
  })

  it('enhancePromptWithEnv — appends env info', () => {
    const prompt = enhancePromptWithEnv(
      ['Base prompt'],
      'claude-sonnet-4-6',
      { cwd: '/project', platform: 'linux' },
    )
    const parts = [...prompt]
    expect(parts[0]).toBe('Base prompt')
    expect(parts.some(p => p.includes('absolute'))).toBe(true)
    expect(parts.some(p => p.includes('linux'))).toBe(true)
  })
})

// ─── Utilities ─────────────────────────────────────────────────────────────

describe('Utilities', () => {
  it('prependBullets — flat items', () => {
    const result = prependBullets(['Item 1', 'Item 2'])
    expect(result).toEqual([' - Item 1', ' - Item 2'])
  })

  it('prependBullets — nested sub-items', () => {
    const result = prependBullets(['Item', ['Sub 1', 'Sub 2']])
    expect(result).toEqual([' - Item', '  - Sub 1', '  - Sub 2'])
  })

  it('joinSections — filters nulls and joins', () => {
    const result = joinSections(['A', null, '', 'B', undefined])
    expect(result).toBe('A\n\nB')
  })
})
