# Architecture

## Agent Loop

The core engine is a streaming-first `while(true)` loop where the model drives tool usage until the task is complete or a stop condition is met. This mirrors codenano's `queryLoop` pattern.

```
createAgent(config)
  |
  +-- Prompt Builder --- builds system prompt from composable sections
  |     |
  |     +-- Static sections (cached)  --- intro, system, tasks, actions, tools, tone, efficiency
  |     +-- Dynamic sections (per-turn) -- environment, language, custom
  |     +-- CLAUDE.md instructions ------ auto-loaded from project hierarchy (opt-in)
  |
  +-- Provider ---------- Anthropic SDK / Bedrock client + streaming
  |     |
  |     +-- Retry with exponential backoff + jitter (429/529)
  |     +-- Model fallback: 3x 529 -> switch to fallbackModel
  |
  +-- Agent Loop -------- the core while(true) cycle:
        |
        v
      auto-compact if approaching context limit
        v
      call model (streaming, with retry)
        |
        +-- streaming tool executor: start tools as blocks complete
        v
      max_tokens? -> escalate 8k->64k -> then inject "resume" -> retry (up to 3x)
        v
      extract tool_use blocks
        v
      no tools? -> stop hook check -> return result
        v
      streaming executor: collect remaining results (or batch fallback)
        v
      validate input (Zod) -> permission check -> execute
        v
      apply tool result budget (50KB per-tool, 200KB per-message)
        v
      append tool_result -> next turn
        v
      on 413 error -> compact -> retry once
      on 3x 529 -> fallback model (if configured)
```

## Three Interaction Modes

| Mode | Method | Use Case |
|------|--------|----------|
| **One-shot** | `agent.ask(prompt)` | Simple question-answer, collects all events internally |
| **Streaming** | `agent.stream(prompt)` | Real-time UI, progress display, token-by-token output |
| **Session** | `agent.session()` | Multi-turn conversations with persistent history |

`ask()` is a convenience wrapper around `stream()` -- streaming is the primitive.

Sessions can optionally persist to disk as JSONL files (`persistence: { enabled: true }`). Each session gets a UUID (`session.id`) and can be resumed later via `agent.session(sessionId)`. The JSONL format mirrors Claude Code's session storage: one entry per line, append-only writes, line-by-line reads for restore.

## Continue Paths

codenano's `queryLoop` has 7 continue paths. The SDK implements 5:

```
codenano queryLoop (7 continue paths):
  1. next_turn              <- normal tool results          [implemented]
  2. reactive_compact_retry <- 413 -> compress -> retry     [implemented]
  3. collapse_drain_retry   <- context collapse -> retry    [missing - simplified to auto-compact]
  4. max_output_recovery    <- truncated -> inject "resume" [implemented]
  5. max_output_escalate    <- 8k -> 64k retry              [implemented - opt-in via maxOutputTokensCap]
  6. stop_hook_blocking     <- hook injects error -> retry  [simplified - onTurnEnd]
  7. token_budget_continue  <- budget not exhausted -> nudge [missing]
```

## Stream Events

```typescript
type StreamEvent =
  | { type: 'text'; text: string }                    // incremental text output
  | { type: 'thinking'; thinking: string }             // extended thinking (if enabled)
  | { type: 'tool_use'; toolName; toolUseId; input }   // tool being called
  | { type: 'tool_result'; toolUseId; output; isError } // tool execution result
  | { type: 'turn_start'; turnNumber }                 // new agent loop turn
  | { type: 'turn_end'; stopReason; turnNumber }       // turn finished
  | { type: 'result'; result: Result }                 // final result
  | { type: 'error'; error: Error }                    // error
```
