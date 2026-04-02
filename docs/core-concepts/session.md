# Session

Sessions enable multi-turn conversations with context.

## Creating a Session

```typescript
const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
})

const session = agent.session()
```

## Using Sessions

```typescript
// Turn 1
const result1 = await session.send('My name is Alice')

// Turn 2 - remembers previous context
const result2 = await session.send('What is my name?')
// Response: "Your name is Alice"
```

## Streaming in Sessions

```typescript
for await (const event of session.stream('Tell me a joke')) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
```

## Query Tracking in Sessions

Sessions maintain the same chainId across turns:

```typescript
const result1 = await session.send('Hello')
// chainId: abc-123, depth: 0

const result2 = await session.send('Continue')
// chainId: abc-123, depth: 1
```

See [Query Tracking](query-tracking.md) for details.

## Session Persistence

Sessions can be saved to disk and resumed later using JSONL-based persistence.

### Enabling Persistence

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  persistence: {
    enabled: true,                      // enable JSONL persistence
    storageDir: './my-sessions',        // optional custom directory
  },
})

const session = agent.session()
console.log(session.id)  // UUID — save this to resume later
await session.send('Analyze the project')
```

When persistence is enabled, every message is automatically appended to a `<sessionId>.jsonl` file after each turn.

### Resuming a Session

Pass a session ID to `agent.session()` to restore previous history:

```typescript
const resumed = agent.session('previous-session-uuid')
console.log(resumed.history.length)  // messages from the previous session
await resumed.send('Continue where we left off')
```

### Listing and Loading Sessions

```typescript
import { listSessions, loadSession } from 'codenano'

// List all saved sessions (sorted by creation time, newest first)
const sessions = listSessions({ storageDir: './my-sessions' })
for (const s of sessions) {
  console.log(`${s.sessionId} — ${s.model} — ${s.createdAt}`)
}

// Load a session's full data
const loaded = loadSession('session-uuid', { storageDir: './my-sessions' })
console.log(loaded.metadata)   // { sessionId, model, createdAt }
console.log(loaded.messages)   // all persisted messages
```

### Storage Format

Each session is stored as a single `.jsonl` file:

```jsonl
{"type":"metadata","timestamp":"...","metadata":{"sessionId":"...","model":"claude-sonnet-4-6","createdAt":"..."}}
{"type":"message","timestamp":"...","message":{"role":"user","content":"Hello"}}
{"type":"message","timestamp":"...","message":{"role":"assistant","content":[...]}}
```

- **Append-only** — each message is appended as it happens, no full rewrites
- **Line-by-line restore** — malformed lines are skipped gracefully
- **Default location** — `~/.agent-core/sessions/` (configurable via `storageDir`)
