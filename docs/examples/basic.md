# Basic Examples

Simple examples to get started with Codenano.

## Hello World

```typescript
import { createAgent } from 'codenano'

const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
})

const result = await agent.ask('Hello!')
console.log(result.text)
```

## Streaming

```typescript
for await (const event of agent.stream('Count to 5')) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
```

## With System Prompt

```typescript
const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are a helpful math tutor.',
})

const result = await agent.ask('Explain calculus')
```

See `examples/basic.ts` for complete code.
