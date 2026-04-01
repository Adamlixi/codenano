/**
 * instructions.ts — CLAUDE.md project instruction loading
 *
 * Simplified port of codenano's CLAUDE.md discovery and loading system.
 * Original: src/utils/claudemd.ts (1480 lines) — we extract the core logic.
 *
 * Discovery order (lowest to highest priority):
 *   1. User-level: ~/.claude/CLAUDE.md, ~/.claude/rules/*.md
 *   2. Project-level: walk from cwd to root, each dir checks:
 *      - CLAUDE.md
 *      - .claude/CLAUDE.md
 *      - .claude/rules/*.md
 *   3. Local (gitignored): CLAUDE.local.md in each project dir
 *
 * Files closer to cwd have higher priority (loaded later, override earlier).
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InstructionFile {
  /** Absolute file path */
  path: string
  /** Content of the file */
  content: string
  /** Source type */
  type: 'user' | 'project' | 'local'
}

export interface LoadInstructionsOptions {
  /** Working directory to start search from (default: process.cwd()) */
  cwd?: string
  /** Load user-level instructions from ~/.claude/ (default: true) */
  loadUserInstructions?: boolean
  /** Load project instructions from CLAUDE.md files (default: true) */
  loadProjectInstructions?: boolean
  /** Load local instructions from CLAUDE.local.md (default: true) */
  loadLocalInstructions?: boolean
  /** Additional instruction files to include */
  additionalFiles?: string[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INSTRUCTION_PREAMBLE =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' +
  'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'

// ─── File Discovery ──────────────────────────────────────────────────────────

/**
 * Discover and load all CLAUDE.md instruction files.
 *
 * Returns the merged instruction content ready to inject into system prompt.
 * Files are loaded from root → cwd (higher priority = loaded later).
 */
export async function loadInstructions(
  options: LoadInstructionsOptions = {},
): Promise<string> {
  const files = await discoverInstructionFiles(options)
  if (files.length === 0) return ''
  return formatInstructions(files)
}

/**
 * Discover all instruction files without merging.
 * Useful for debugging or custom processing.
 */
export async function discoverInstructionFiles(
  options: LoadInstructionsOptions = {},
): Promise<InstructionFile[]> {
  const cwd = options.cwd ?? process.cwd()
  const files: InstructionFile[] = []

  // 1. User-level instructions (~/.claude/)
  if (options.loadUserInstructions !== false) {
    const userFiles = discoverUserInstructions()
    files.push(...userFiles)
  }

  // 2. Project-level instructions (walk from root → cwd)
  if (options.loadProjectInstructions !== false) {
    const projectFiles = discoverProjectInstructions(cwd)
    files.push(...projectFiles)
  }

  // 3. Local instructions (CLAUDE.local.md, gitignored)
  if (options.loadLocalInstructions !== false) {
    const localFiles = discoverLocalInstructions(cwd)
    files.push(...localFiles)
  }

  // 4. Additional files
  if (options.additionalFiles) {
    for (const filePath of options.additionalFiles) {
      const content = readFileSafe(filePath)
      if (content) {
        files.push({ path: filePath, content, type: 'project' })
      }
    }
  }

  return files
}

/**
 * Format instruction files into a single string for system prompt injection.
 */
export function formatInstructions(files: InstructionFile[]): string {
  if (files.length === 0) return ''

  const sections = files.map(file => {
    const typeLabel =
      file.type === 'user' ? "(user's private global instructions for all projects)" :
      file.type === 'project' ? '(project instructions, checked into the codebase)' :
      "(user's private project instructions, not checked in)"

    return `Contents of ${file.path} ${typeLabel}:\n\n${stripFrontmatter(file.content)}`
  })

  return `${INSTRUCTION_PREAMBLE}\n\n${sections.join('\n\n')}`
}

// ─── Discovery Helpers ───────────────────────────────────────────────────────

function discoverUserInstructions(): InstructionFile[] {
  const files: InstructionFile[] = []
  const claudeHome = getClaudeConfigHome()
  if (!claudeHome) return files

  // ~/.claude/CLAUDE.md
  const userClaudeMd = path.join(claudeHome, 'CLAUDE.md')
  const content = readFileSafe(userClaudeMd)
  if (content) {
    files.push({ path: userClaudeMd, content, type: 'user' })
  }

  // ~/.claude/rules/*.md (recursive)
  const rulesDir = path.join(claudeHome, 'rules')
  const ruleFiles = discoverRulesDir(rulesDir)
  for (const rulePath of ruleFiles) {
    const ruleContent = readFileSafe(rulePath)
    if (ruleContent) {
      files.push({ path: rulePath, content: ruleContent, type: 'user' })
    }
  }

  return files
}

function discoverProjectInstructions(cwd: string): InstructionFile[] {
  const files: InstructionFile[] = []

  // Collect directories from cwd up to root
  const dirs: string[] = []
  let currentDir = path.resolve(cwd)
  const root = path.parse(currentDir).root

  while (currentDir !== root) {
    dirs.push(currentDir)
    const parent = path.dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
  }

  // Process from root → cwd (reverse) so cwd files have highest priority
  dirs.reverse()

  for (const dir of dirs) {
    // CLAUDE.md
    const claudeMd = path.join(dir, 'CLAUDE.md')
    const claudeMdContent = readFileSafe(claudeMd)
    if (claudeMdContent) {
      files.push({ path: claudeMd, content: claudeMdContent, type: 'project' })
    }

    // .claude/CLAUDE.md
    const dotClaudeMd = path.join(dir, '.claude', 'CLAUDE.md')
    const dotContent = readFileSafe(dotClaudeMd)
    if (dotContent) {
      files.push({ path: dotClaudeMd, content: dotContent, type: 'project' })
    }

    // .claude/rules/*.md (recursive)
    const rulesDir = path.join(dir, '.claude', 'rules')
    const ruleFiles = discoverRulesDir(rulesDir)
    for (const rulePath of ruleFiles) {
      const ruleContent = readFileSafe(rulePath)
      if (ruleContent) {
        files.push({ path: rulePath, content: ruleContent, type: 'project' })
      }
    }
  }

  return files
}

function discoverLocalInstructions(cwd: string): InstructionFile[] {
  const files: InstructionFile[] = []

  let currentDir = path.resolve(cwd)
  const root = path.parse(currentDir).root

  // Walk from cwd up, collecting CLAUDE.local.md files
  const localPaths: string[] = []
  while (currentDir !== root) {
    localPaths.push(path.join(currentDir, 'CLAUDE.local.md'))
    const parent = path.dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
  }

  // Process root → cwd order
  localPaths.reverse()

  for (const localPath of localPaths) {
    const content = readFileSafe(localPath)
    if (content) {
      files.push({ path: localPath, content, type: 'local' })
    }
  }

  return files
}

/**
 * Recursively discover .md files in a rules directory.
 */
function discoverRulesDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return []

  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...discoverRulesDir(fullPath))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath)
      }
    }
  } catch {
    // Permission denied or other error — skip
  }
  return results.sort()
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function getClaudeConfigHome(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (!home) return null
  const claudeDir = path.join(home, '.claude')
  return fs.existsSync(claudeDir) ? claudeDir : null
}

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Strip YAML frontmatter from markdown content.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const endIndex = content.indexOf('---', 3)
  if (endIndex === -1) return content
  return content.slice(endIndex + 3).trimStart()
}
