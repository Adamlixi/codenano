# System Prompt Architecture

The prompt system is faithfully reproduced from Claude Code's internal architecture. It composes a system prompt from independent, cacheable sections.

## Section Layout

```
+-------------------------------------+
| Static Sections (cached once)       |
|  +-- Intro (identity)               |
|  +-- System (tool model, hooks)     |
|  +-- Tasks (coding best practices)  |
|  +-- Actions (risk/reversibility)   |
|  +-- Tools (dynamic per tool set)   |
|  +-- Tone (communication style)     |
|  +-- Efficiency (conciseness)       |
+--- DYNAMIC BOUNDARY ----------------+
| Dynamic Sections (per-turn)         |
|  +-- Environment (cwd, platform)    |
|  +-- Language (if set)              |
|  +-- Output Style (if set)          |
|  +-- Custom Sections (developer)    |
+--- CLAUDE.md (opt-in) --------------+
|  +-- Project/user instructions      |
+-------------------------------------+
```

## Static Sections

These are built once and cached for the lifetime of the agent:

| Section | Content |
|---------|---------|
| **intro** | Agent identity, output style preferences |
| **system** | Tool execution model, permissions, hooks |
| **tasks** | Coding best practices, security, simplicity |
| **actions** | Risk assessment, reversibility guidance |
| **tools** | Dynamic tool usage hints (generated per tool set) |
| **tone** | Emoji rules, file references, markdown style |
| **efficiency** | Output conciseness guidance |

## Dynamic Sections

Rebuilt each turn to reflect current state:

| Section | Content |
|---------|---------|
| **environment** | cwd, platform, model, git status |
| **language** | Response language preference (if set) |
| **outputStyle** | Custom output style configuration (if set) |
| **custom** | Developer-provided custom sections |

## Source Files

```
src/prompt/
  +-- index.ts          # barrel export
  +-- types.ts          # SystemPrompt branded type, PromptSection, EnvironmentInfo
  +-- builder.ts        # buildSystemPrompt(), buildEffectiveSystemPrompt()
  +-- sections.ts       # caching: systemPromptSection(), uncachedSection(), clearSections()
  +-- utils.ts          # prependBullets(), joinSections()
  +-- sections/         # individual section generators
      +-- intro.ts      #   identity + output style
      +-- system.ts     #   tool execution model, permissions, hooks
      +-- tasks.ts      #   coding best practices, security, simplicity
      +-- actions.ts    #   risk assessment, reversibility guidance
      +-- tools.ts      #   dynamic tool usage hints
      +-- tone.ts       #   emoji rules, file references, markdown style
      +-- efficiency.ts #   output conciseness guidance
      +-- environment.ts#   runtime info (cwd, platform, model, git status)
      +-- language.ts   #   response language preference
      +-- outputStyle.ts#   custom output style configuration
      +-- custom.ts     #   developer custom sections
```
