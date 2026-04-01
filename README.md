# agent-core

SDK for building AI coding agents, extracted from Claude Code's core architecture (~5,500 lines vs ~150,000+).

## Install

```bash
npm install agent-core
```

## Quick Start

```typescript
import { createAgent, defineTool, coreTools } from 'agent-core'
import { z } from 'zod'

// With built-in tools
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: coreTools(),  // Read, Edit, Write, Glob, Grep, Bash
})

const result = await agent.ask('Read package.json and summarize it')
console.log(result.text)

// Streaming
for await (const event of agent.stream('What files are here?')) {
  if (event.type === 'text') process.stdout.write(event.text)
}

// Multi-turn session
const session = agent.session()
await session.send('Read main.ts')
await session.send('Now explain what it does')
```

### Custom Tools

```typescript
const readFile = defineTool({
  name: 'ReadFile',
  description: 'Read a file from disk',
  input: z.object({ path: z.string() }),
  execute: async ({ path }) => fs.readFileSync(path, 'utf-8'),
  isReadOnly: true,
  isConcurrencySafe: true,
})

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: [readFile],
})
```

## System Structure

```
agent-core/
  src/
    index.ts                    # barrel export (~40 items)
    types.ts                    # public types
    agent.ts                    # createAgent() + agent loop
    session.ts                  # Session class (multi-turn)
    events.ts                   # stream event transformation
    tool-builder.ts             # defineTool() helper
    provider.ts                 # Anthropic SDK / Bedrock + retry + fallback
    compact.ts                  # auto-compact + token estimation
    instructions.ts             # CLAUDE.md discovery and loading
    tool-budget.ts              # tool result size truncation
    streaming-tool-executor.ts  # execute tools during model streaming
    tools/                      # 17 built-in tools (3 tiers)
      index.ts                  # presets: coreTools(), extendedTools(), allTools()
      FileReadTool.ts           # Read files
      FileEditTool.ts           # Exact string replacement
      FileWriteTool.ts          # Create/overwrite files
      GlobTool.ts               # File pattern matching
      GrepTool.ts               # Regex search (ripgrep)
      BashTool.ts               # Shell commands
      ...                       # + 11 more (see docs/tools.md)
    prompt/                     # system prompt builder
      builder.ts                # buildSystemPrompt()
      sections/                 # 11 composable prompt sections
  tests/                        # 191 tests across 12 files
  examples/                     # basic.ts, with-tools.ts, streaming.ts
  docs/                         # detailed documentation
```

## Documentation

| Doc | Content |
|-----|---------|
| [Architecture](docs/architecture.md) | Agent loop, interaction modes, continue paths, stream events |
| [Tools](docs/tools.md) | Built-in tools, presets, custom tools, concurrency, permissions |
| [Configuration](docs/configuration.md) | Full config reference, provider detection, prompt priority, CLAUDE.md |
| [Reliability](docs/reliability.md) | Auto-compact, 413 recovery, max output escalation, retry, fallback, budgeting |
| [Prompt System](docs/prompt-system.md) | System prompt architecture, section layout, source files |
| [Gap Analysis](docs/gap-analysis.md) | SDK vs Claude Code: equivalent, simplified, missing |
| [Engine Reference](docs/engine-reference/) | Original Claude Code source files (annotated) |

## Testing

```bash
npm test                                          # 191 unit tests
npx vitest run --coverage                         # with coverage

# Integration tests — direct API
ANTHROPIC_API_KEY=sk-xxx npm run test:integration

# Integration tests — external proxy endpoint
ANTHROPIC_API_KEY=sk-xxx ANTHROPIC_BASE_URL=https://your-proxy.com npm run test:integration

# With throttling for rate-limited proxies
E2E_THROTTLE_MS=5000 ANTHROPIC_API_KEY=sk-xxx npm run test:integration
```

## TODO


- [ ] Hook system (PreToolUse, PostToolUse, SessionStart -- 16 event types)
- [ ] Sub-agent spawning (wire AgentTool -> createAgent recursively)
- [ ] Memory system (post-turn learning extraction, cross-session persistence)
- [ ] MCP protocol support (auth, resources, tools, elicitation)
- [ ] Permission rules (source-layered rules, allow/deny lists, bash classifier)

- [ ] Session persistence (save/resume transcripts)
- [ ] Skill/plugin system
- [ ] Git integration (commit attribution, branch tracking)
- [ ] Cost tracking (running USD accumulation)
- [ ] Abort mid-stream (synthetic tool_results for orphaned blocks)

### Continue Paths (2 remaining)

- [ ] `collapse_drain_retry` -- context collapse -> retry (currently simplified to auto-compact)
- [ ] `token_budget_continue` -- budget not exhausted -> nudge

## License

Extracted from Claude Code for educational and development purposes.
