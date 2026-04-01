# Tools

## Defining Tools

Tools are defined with Zod schemas for type-safe input validation:

```typescript
import { defineTool } from 'agent-core'
import { z } from 'zod'

const grep = defineTool({
  name: 'Grep',
  description: 'Search file contents with regex',
  input: z.object({
    pattern: z.string().describe('Regex pattern'),
    path: z.string().optional().describe('Directory to search'),
  }),
  execute: async ({ pattern, path }) => {
    return execSync(`grep -r "${pattern}" ${path ?? '.'}`).toString()
  },
  isReadOnly: true,           // enables concurrent execution
  isConcurrencySafe: true,    // safe to run in parallel
})
```

The SDK converts Zod schemas to JSON Schema via `zod-to-json-schema` for the Anthropic API, then validates inputs again at runtime before calling `execute()`.

## Built-in Tool Presets

17 tools extracted from Claude Code, organized in three tiers:

```typescript
import { createAgent, coreTools, extendedTools, allTools } from 'agent-core'

// Core: Read, Edit, Write, Glob, Grep, Bash
createAgent({ model: 'claude-sonnet-4-6', tools: coreTools() })

// Extended: + NotebookEdit, WebFetch, Brief, Tasks, Todos
createAgent({ model: 'claude-sonnet-4-6', tools: extendedTools() })

// All: + WebSearch(stub), LSP(stub), Agent(stub), AskUser(stub), Skill(stub)
createAgent({ model: 'claude-sonnet-4-6', tools: allTools() })
```

### Tier 1: Fully Functional

| Tool | Concurrent | ReadOnly | Description |
|------|:----------:|:--------:|-------------|
| `Read` | yes | yes | Read files with line numbers, offset/limit |
| `Edit` | no | no | Exact string replacement with uniqueness check |
| `Write` | no | no | Create or overwrite files |
| `Glob` | yes | yes | Find files by glob pattern |
| `Grep` | yes | yes | Regex search via ripgrep (grep fallback) |
| `Bash` | dynamic | dynamic | Shell commands, read-only detection by prefix |
| `NotebookEdit` | no | no | Edit/insert/delete Jupyter cells |
| `WebFetch` | yes | yes | Fetch URL and extract content |
| `Brief` | yes | yes | Toggle brief/verbose response mode |

### Tier 2: Default Backend

| Tool | Description |
|------|-------------|
| `TaskCreate` | Create a tracked task |
| `TaskUpdate` | Update task status/output |
| `TaskGet` | Get task details |
| `TaskList` | List all tasks |
| `TaskStop` | Stop a running task |
| `TodoWrite` | Session checklist management |

These use in-memory storage. Reset with `resetTaskStore()` / `resetTodos()`.

### Tier 3: Schema Stubs

These have correct input schemas but return errors by default. Override `execute` to use them:

| Tool | Required Backend |
|------|-----------------|
| `WebSearch` | Search API (Brave, Serper, Tavily) |
| `LSP` | Language Server Protocol client |
| `Agent` | Agent spawning via `createAgent()` |
| `AskUser` | User interaction channel (stdin, UI, etc.) |
| `Skill` | Skill/plugin execution runtime |

### Overriding Stub Execute

```typescript
import { WebSearchTool, AgentTool, defineTool } from 'agent-core'

// Method 1: Spread and override
const myWebSearch = {
  ...WebSearchTool,
  execute: async (input) => {
    const res = await fetch(`https://api.tavily.com/search?q=${input.query}`)
    return await res.text()
  },
}

// Method 2: Redefine with defineTool (recommended, type-safe)
const myAgent = defineTool({
  name: 'Agent',
  description: 'Spawn a sub-agent',
  input: AgentTool.input,
  async execute(input) {
    const sub = createAgent({ model: 'claude-sonnet-4-6', tools: coreTools() })
    const result = await sub.ask(input.prompt)
    return result.text
  },
})
```

### Mixing Presets with Custom Tools

```typescript
const agent = createAgent({
  tools: [...coreTools(), myCustomTool, myWebSearch],
})
```

## Tool Concurrency

When `streamingToolExecution: true` (default), the streaming tool executor uses concurrency properties:

- `isConcurrencySafe: true` -- runs in parallel with other safe tools
- `isConcurrencySafe: false` -- runs alone, blocks other tools

BashTool is dynamic: `git log` runs concurrently, `npm install` runs exclusively.

Consecutive concurrency-safe tools are batched together. Non-safe tools get exclusive access.

## Streaming Tool Executor

Tools start executing as soon as their content block completes in the model stream -- no waiting for the full response.

```typescript
// Enabled by default
const agent = createAgent({
  tools: [readFile, writeFile],
  streamingToolExecution: true,  // default
})

// Disable for deterministic ordering (batch mode)
const agent = createAgent({
  tools: [readFile, writeFile],
  streamingToolExecution: false,
})
```

**Standalone usage** (for custom pipelines):

```typescript
import { StreamingToolExecutor } from 'agent-core'

const executor = new StreamingToolExecutor(toolMap, config, signal, messages)
executor.addTool(toolUseBlock)  // start immediately

// Non-blocking: check for completed results
for (const result of executor.getCompletedResults()) { ... }

// Blocking: wait for all remaining tools
for await (const result of executor.getRemainingResults()) { ... }
```

## Permission System

Optional callback to control tool usage:

```typescript
const agent = createAgent({
  tools: [readFile, writeFile, bash],
  canUseTool: (toolName, input) => {
    if (toolName === 'Bash' && input.command?.includes('rm'))
      return { behavior: 'deny', message: 'Destructive commands not allowed' }
    return { behavior: 'allow' }
  },
})
```

If denied, the tool_result is returned to the model as an error, letting it adapt.
