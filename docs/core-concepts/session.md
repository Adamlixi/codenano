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
