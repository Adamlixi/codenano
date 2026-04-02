# Query Tracking Examples

Examples demonstrating Query Tracking features.

## Example 1: Basic Usage

```typescript
import { createAgent } from 'codenano'

const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
})

for await (const event of agent.stream('Say hello')) {
  if (event.type === 'query_start') {
    console.log('Query started:')
    console.log('  Chain ID:', event.queryTracking.chainId)
    console.log('  Depth:', event.queryTracking.depth)
  }

  if (event.type === 'result') {
    console.log('Query completed:')
    console.log('  Chain ID:', event.result.queryTracking.chainId)
    console.log('  Depth:', event.result.queryTracking.depth)
  }
}
```

## Example 2: Session Depth

```typescript
const session = agent.session()

// Turn 1 - Depth 0
const result1 = await session.send('My name is Alice')
console.log('Turn 1:', result1.queryTracking)

// Turn 2 - Depth 1
const result2 = await session.send('What is my name?')
console.log('Turn 2:', result2.queryTracking)

// Turn 3 - Depth 2
const result3 = await session.send('Repeat it')
console.log('Turn 3:', result3.queryTracking)
```

## Example 3: With Logging

```typescript
function log(level: string, message: string, tracking: any) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [${level}] [${tracking.chainId.slice(0, 8)}:${tracking.depth}] ${message}`)
}

for await (const event of agent.stream('Calculate 10 + 20')) {
  if (event.type === 'query_start') {
    log('INFO', 'Query started', event.queryTracking)
  }
  
  if (event.type === 'result') {
    log('INFO', `Completed in ${event.result.durationMs}ms`, event.result.queryTracking)
  }
}
```

## More Examples

See `examples/query-tracking-examples.ts` for complete examples.
