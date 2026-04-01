# Gap Analysis: codenano vs Claude Code

This codenano SDK captures Claude Code's core agent loop in ~5,500 lines (vs ~150,000+).

## What's Equivalent

| System | Detail |
|--------|--------|
| **Agent loop** | `while(true) -> call model -> extract tool_use -> execute -> repeat` |
| **Streaming** | `callModelStreaming()` yields same event types, `stream()` is the primitive |
| **System prompt** | All 11 sections faithfully reproduced with static/dynamic boundary and caching |
| **Prompt priority** | `override > agent > custom > default > append` |
| **Session** | Multi-turn with persistent history via `session.send()` / `session.stream()` |
| **Tool builder** | `defineTool()` with Zod schemas, validation, `isReadOnly`/`isConcurrencySafe` |
| **Provider** | Anthropic direct + Bedrock auto-detection, `baseURL` proxy support |
| **Tool concurrency** | `partitionToolCalls()` groups consecutive safe tools, runs in parallel (max 10) |
| **Auto-compact** | Token threshold check -> LLM summarization -> continuation message |
| **413 recovery** | Detect prompt-too-long -> compact -> retry once |
| **Max output recovery** | `stop_reason: 'max_tokens'` -> inject resume -> retry (up to 3x) |
| **Model fallback** | 3x consecutive 529 -> switch to `fallbackModel` |
| **Retry/backoff** | Exponential backoff + jitter (500ms base, 32s cap, 3 retries) |
| **Tool result budget** | Per-tool 50KB cap, per-message 200KB aggregate, 2KB preview |
| **CLAUDE.md loading** | Discovers user/project/local/rules files from directory hierarchy |
| **Streaming tool executor** | Tools start executing as content blocks complete during stream |
| **Max output escalation** | 8K cap -> 64K escalation before recovery inject (opt-in) |

## What's Simplified (by design)

| Claude Code | codenano | Rationale |
|-------------|-----|-----------|
| 6 permission modes + rule layers + ML classifier | Single `canUseTool` callback | SDK users implement their own policy |
| 16 hook event types | `onTurnEnd` only | Extensibility via callbacks, not config files |
| Zustand app state + React Context | Stateless -- config in, result out | SDK doesn't own the UI |
| 101 slash commands | None | SDK, not CLI |
| Terminal UI (146 Ink components) | Headless -- `StreamEvent` only | Users build their own UI |
| Analytics (Datadog, Growthbook) | None | Users bring their own observability |
| 6-layer compaction | 2-layer: auto-compact + 413 reactive | Covers 90% of use cases |
| 2-tier budgeting (per-tool disk persist + per-message aggregate) | Single-tier inline truncation | No disk persistence needed |
| CLAUDE.md 1480-line pipeline (@include, conditional, frontmatter) | ~200 lines, core discovery only | SDK needs discovery, not enterprise features |
| StreamingToolExecutor (531 lines) | ~200 lines, core queue + concurrent execution | No progress streaming or context modification |
| Max output cap (GrowthBook feature gate) | Config-based `maxOutputTokensCap` option | No feature flags needed |

## What's Missing

### P2 -- Missing Subsystems

| Gap | Claude Code | codenano | Impact |
|-----|-------------|-----|--------|
| **Hook system** | 16 event types: PreToolUse, PostToolUse, SessionStart, etc. | `onTurnEnd` only | No extensibility points for middleware |
| **Memory system** | Auto-extract learnings, auto-dream consolidation, 4 memory types | None | No cross-session learning |
| **MCP protocol** | Full MCP client: auth, resources, tools, elicitation | None | No tool marketplace integration |
| **Sub-agent spawning** | `AgentTool` -> `runForkedAgent()` with shared prompt cache | Stub tool only | No recursive agent hierarchies |
| **Permission rules** | Source-layered rules, always-allow/deny lists, bash classifier | Callback only | SDK users must build their own rule engine |

### P3 -- Nice to Have

| Gap | codenano | SDK |
|-----|-------------|-----|
| Session persistence | Transcript saved to disk, `/resume` to reload | None |
| Skill/plugin system | Loadable skills from disk + marketplace | None |
| Git integration | Commit attribution, branch tracking, worktrees | None |
| Cost tracking | Running USD cost accumulation | `Usage` in `Result` only |
| Abort mid-stream | Synthetic tool_results for orphaned tool_use blocks | Loop break, partial result |

## Systems Intentionally Excluded

| System | Why |
|--------|-----|
| Terminal UI (Ink, 146 components) | SDK is headless |
| Voice mode (STT/TTS) | Application-layer concern |
| Desktop bridge (REPL-desktop IPC) | IDE integration, not SDK |
| Remote sessions (WebSocket) | Application-layer concern |
| Analytics (Datadog, Growthbook) | Users bring their own observability |
| 101 slash commands | CLI concern |
