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

  // -- Memory -----------------------------------
  memory?: {
    memoryDir?: string                 // custom memory directory
    autoLoad?: boolean                 // load into system prompt (default: true)
    extractStrategy?: ExtractStrategy  // 'disabled' | 'auto' | { interval: N }
    extractMaxTurns?: number           // extraction agent max turns (default: 3)
    useForkedAgent?: boolean           // forked agent with prompt caching (default: false)
  }

  // -- Session Persistence ----------------------
  persistence?: {
    enabled: boolean                   // enable JSONL persistence (default: false)
    storageDir?: string                // custom storage dir (default: ~/.agent-core/sessions/)
    resumeSessionId?: string           // resume an existing session by ID
  }

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
import { loadInstructions, discoverInstructionFiles } from 'codenano'

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

## Memory System

Persistent cross-session memory. The agent can save learnings and load them in future sessions.

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  memory: {
    autoLoad: true,           // inject memories into system prompt
    extractStrategy: 'auto',  // extract after every turn
  },
})
```

**Extract strategies:**
- `'disabled'` (default) -- no automatic extraction
- `'auto'` -- extract after every completed turn (fire-and-forget)
- `{ interval: N }` -- extract every N completed turns

**Standalone API:**

```typescript
import { saveMemory, loadMemory, scanMemories, loadMemoryIndex } from 'codenano'

// Save a memory
await saveMemory({ dir: '/path/to/memory', name: 'user-prefs', content: '...' })

// Load all memories
const memories = await loadMemory({ dir: '/path/to/memory' })

// Scan for memory files
const files = await scanMemories({ dir: '/path/to/memory' })

// Load MEMORY.md index
const index = await loadMemoryIndex({ dir: '/path/to/memory' })
```

## Session Persistence

Save and resume multi-turn sessions using JSONL files. Inspired by Claude Code's session storage design.

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: coreTools(),
  persistence: {
    enabled: true,                    // enable JSONL persistence
    storageDir: './my-sessions',      // optional custom directory
  },
})

// Start a new session — messages auto-save after each turn
const session = agent.session()
console.log(session.id)  // UUID — save this to resume later
await session.send('Analyze the codebase')

// Resume an existing session by ID
const resumed = agent.session(session.id)
// resumed.history contains all previous messages
await resumed.send('What did we find?')
```

**Storage format:** Each session is a `<sessionId>.jsonl` file. The first line is metadata, subsequent lines are messages. Append-only writes, line-by-line reads for restore.

**Standalone API:**

```typescript
import { listSessions, loadSession, getSessionStorageDir } from 'codenano'

// List all saved sessions
const sessions = listSessions({ storageDir: './my-sessions' })

// Load a specific session
const loaded = loadSession('session-uuid', { storageDir: './my-sessions' })
console.log(loaded.metadata)   // { sessionId, model, createdAt }
console.log(loaded.messages)   // MessageParam[]

// Get the storage directory path
const dir = getSessionStorageDir()  // ~/.agent-core/sessions/
```
