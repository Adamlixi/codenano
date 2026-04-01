# Configuration

## Full Reference

```typescript
interface AgentConfig {
  // -- Required ---------------------------------
  model: string                        // e.g. 'claude-sonnet-4-6'

  // -- API --------------------------------------
  apiKey?: string                      // default: ANTHROPIC_API_KEY env var
  baseURL?: string                     // custom API endpoint (proxy)
  provider?: 'anthropic' | 'bedrock'   // default: auto-detected
  awsRegion?: string                   // for Bedrock

  // -- Tools ------------------------------------
  tools?: ToolDef[]                    // available tools
  canUseTool?: PermissionFn            // permission callback
  toolResultBudget?: boolean           // truncate oversized results (default: true)

  // -- Prompt -----------------------------------
  systemPrompt?: string                // custom system prompt
  identity?: string                    // agent identity for prompt builder
  language?: string                    // response language preference
  overrideSystemPrompt?: string        // override everything
  appendSystemPrompt?: string          // append to any prompt
  autoLoadInstructions?: boolean       // load CLAUDE.md files (default: false)

  // -- Behavior ---------------------------------
  maxTurns?: number                    // default: 30
  maxOutputTokens?: number             // default: 16384
  thinkingConfig?: 'adaptive' | 'disabled'
  onTurnEnd?: StopHookFn              // stop hook

  // -- Reliability ------------------------------
  autoCompact?: boolean                // compress on context overflow (default: true)
  fallbackModel?: string               // switch on 3x 529 errors
  maxOutputRecoveryAttempts?: number   // resume on max_tokens (default: 3)
  maxOutputTokensCap?: boolean         // 8K->64K escalation (default: false)
  streamingToolExecution?: boolean     // start tools during stream (default: true)
}
```

## Provider Auto-Detection

| Condition | Provider |
|-----------|----------|
| `CLAUDE_CODE_USE_BEDROCK=1` | Bedrock |
| `ANTHROPIC_BEDROCK_BASE_URL` set | Bedrock |
| `AWS_PROFILE` set, no `ANTHROPIC_API_KEY` | Bedrock |
| Otherwise | Anthropic (direct) |

## Prompt Priority Chain

```
overrideSystemPrompt  ->  replaces everything (highest priority)
    | (not set)
systemPrompt          ->  replaces default built prompt
    | (not set)
buildSystemPrompt()   ->  auto-built from sections (default)
    | (always)
appendSystemPrompt    ->  appended at the end (always applied)
    | (if autoLoadInstructions)
CLAUDE.md             ->  project instructions appended
```

## CLAUDE.md Instructions

Auto-load project instructions from the filesystem:

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  autoLoadInstructions: true,  // opt-in
})
```

**Discovery order** (lowest to highest priority):
1. `~/.claude/CLAUDE.md` -- user-level global instructions
2. `~/.claude/rules/*.md` -- user-level rules
3. Walk from root to cwd: `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`
4. Walk from root to cwd: `CLAUDE.local.md` (gitignored, private)

Standalone API:

```typescript
import { loadInstructions, discoverInstructionFiles } from 'agent-core'

const instructions = await loadInstructions({ cwd: '/my/project' })
const files = await discoverInstructionFiles({
  loadUserInstructions: true,
  loadProjectInstructions: true,
  loadLocalInstructions: false,
})
```

## Stop Hooks

Intercept the agent before it finishes to add follow-up behavior:

```typescript
const agent = createAgent({
  onTurnEnd: ({ messages, lastResponse }) => {
    if (!lastResponse.includes('DONE'))
      return { continueWith: 'You forgot to mark the task as DONE.' }
    return {}
  },
})
```
