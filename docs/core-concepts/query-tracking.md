# Query Tracking

Query Tracking helps you debug and monitor AI agent query chains.

## Overview

Every query has:
- **chainId** - Unique identifier for the query chain
- **depth** - Nesting level (0 for main query, increments for recursive calls)

## Basic Usage

### Listen to Events

```typescript
for await (const event of agent.stream('Hello')) {
  if (event.type === 'query_start') {
    console.log('Chain ID:', event.queryTracking.chainId)
    console.log('Depth:', event.queryTracking.depth)
  }
}
```

### From Result

```typescript
const result = await agent.ask('Hello')
console.log(result.queryTracking)
// { chainId: '...', depth: 0 }
```

## Session Tracking

In sessions, all turns share the same chainId:

```typescript
const session = agent.session()

const result1 = await session.send('My name is Alice')
// chainId: abc-123, depth: 0

const result2 = await session.send('What is my name?')
// chainId: abc-123, depth: 1 (same chain, incremented depth)
```

## Use Cases

### Debugging
Track the entire query chain when debugging issues.

### Logging
Include chainId and depth in all logs:

```typescript
function log(level, message, tracking) {
  console.log(`[${tracking.chainId.slice(0, 8)}:${tracking.depth}] ${message}`)
}
```

### Analytics
Analyze performance by depth level.

## Examples

See [Query Tracking Examples](../examples/query-tracking.md) for more.
