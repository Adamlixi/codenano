# Quick Start

Get started with Codenano in 5 minutes.

## Installation

```bash
npm install codenano
```

## Basic Usage

```typescript
import { createAgent } from 'codenano'

const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
})

const result = await agent.ask('Hello!')
console.log(result.text)
```

## With Streaming

```typescript
for await (const event of agent.stream('Count to 5')) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
```

## With Tools

```typescript
import { defineTool } from 'codenano'
import { z } from 'zod'

const calculator = defineTool({
  name: 'Calculator',
  description: 'Perform calculations',
  input: z.object({ expression: z.string() }),
  execute: async ({ expression }) => eval(expression).toString(),
})

const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
  tools: [calculator],
})

const result = await agent.ask('What is 15 * 23?')
```

## Next Steps

- [Learn about Agents](../core-concepts/agent.md)
- [Explore Tools](../core-concepts/tools.md)
- [See more examples](../examples/basic.md)
