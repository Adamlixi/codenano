# Reliability

## Auto-Compact

When the conversation approaches the context window limit, the agent automatically summarizes the history using an LLM call, then replaces messages with a compact continuation.

**Thresholds** (matching Claude Code constants):
- Context window: 200K tokens (all Claude models)
- Effective window: contextWindow - min(maxOutputTokens, 20K)
- Compact threshold: effectiveWindow - 13K buffer
- Token estimation: `inputTokens + outputTokens` from last API response

```typescript
const agent = createAgent({
  autoCompact: true,  // default
})
```

## 413 Recovery

If the API returns a "prompt too long" error (HTTP 413), the agent automatically compacts the conversation and retries once. If compaction fails, the error surfaces to the caller.

## Max Output Escalation + Recovery

When the model hits its output token limit (`stop_reason: 'max_tokens'`), the agent uses a two-stage approach:

**Stage 1 -- Escalation** (if `maxOutputTokensCap` enabled): Retry the same messages at 64K tokens (no recovery message). Avoids an extra API call when the 8K default was too small.

**Stage 2 -- Recovery inject**: If escalation already happened (or cap is disabled), inject a "resume" message and continue. Up to 3 recovery attempts by default.

```typescript
// With cap + escalation
const agent = createAgent({
  maxOutputTokensCap: true,     // start at 8K, escalate to 64K on hit
  maxOutputRecoveryAttempts: 3, // then inject "resume" (default)
})

// Without cap (recovery only)
const agent = createAgent({
  maxOutputRecoveryAttempts: 3,  // default
})
```

Flow:
```
max_tokens hit
  +-- cap enabled? -> escalate 8K -> 64K (same messages, no recovery text)
  |     +-- succeeds -> continue normally
  |     +-- hits limit again -> fall through to recovery
  +-- recovery inject: "Resume directly -- no apology, no recap..."
        +-- up to 3 attempts (configurable)
```

## Retry with Exponential Backoff

API calls automatically retry on transient errors (429/529):

- Base delay: 500ms, doubles each attempt
- Jitter: 0-25% of base delay (prevents thundering herd)
- Max delay: 32 seconds
- Max retries: 3

## Model Fallback

After 3 consecutive 529 (overloaded) errors, the agent switches to a fallback model:

```typescript
const agent = createAgent({
  model: 'claude-opus-4-6',
  fallbackModel: 'claude-sonnet-4-6',
})
```

## Tool Result Budgeting

Tool results are automatically truncated to prevent context bloat:

- **Per-tool cap**: 50KB (matching Claude Code's `DEFAULT_MAX_RESULT_SIZE_CHARS`)
- **Per-message cap**: 200KB aggregate across all tool results in one message
- **Preview**: First 2KB of truncated content, cut at nearest newline

```typescript
// Standalone usage
import { truncateToolResult, applyMessageBudget } from 'agent-core'

const budgeted = truncateToolResult(largeOutput, 50_000)
const budgetedBlocks = applyMessageBudget(contentBlocks, 200_000)
```
