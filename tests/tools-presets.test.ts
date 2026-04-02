/**
 * Unit tests for tool presets (coreTools, extendedTools, allTools)
 */

import { describe, it, expect } from 'vitest'
import { coreTools, extendedTools, allTools } from '../src/tools/index.js'

describe('Tool presets', () => {
  it('coreTools returns 6 tools', () => {
    const tools = coreTools()
    expect(tools).toHaveLength(6)
    const names = tools.map(t => t.name)
    expect(names).toContain('Read')
    expect(names).toContain('Edit')
    expect(names).toContain('Write')
    expect(names).toContain('Glob')
    expect(names).toContain('Grep')
    expect(names).toContain('Bash')
  })

  it('extendedTools includes core + extras', () => {
    const tools = extendedTools()
    expect(tools.length).toBeGreaterThan(6)
    const names = tools.map(t => t.name)
    // Core tools present
    expect(names).toContain('Read')
    expect(names).toContain('Bash')
    // Extended tools present
    expect(names).toContain('NotebookEdit')
    expect(names).toContain('WebFetch')
    expect(names).toContain('Brief')
    expect(names).toContain('TaskCreate')
    expect(names).toContain('TodoWrite')
  })

  it('allTools includes stubs', () => {
    const tools = allTools()
    const names = tools.map(t => t.name)
    expect(names).toContain('WebSearch')
    expect(names).toContain('LSP')
    expect(names).toContain('Agent')
    expect(names).toContain('AskUserQuestion')
    expect(names).toContain('Skill')
  })

  it('all tools have required fields', () => {
    for (const tool of allTools()) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.input).toBeTruthy()
      expect(typeof tool.execute).toBe('function')
    }
  })
})
