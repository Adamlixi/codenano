# Codenano

> A lightweight SDK for building AI coding agents powered by Claude

## What is Codenano?

Codenano is a TypeScript SDK that makes it easy to build AI coding agents. It provides a simple, intuitive API for interacting with Claude while handling the complexity of tool execution, streaming, error recovery, and context management.

## Key Features

- **Simple API** - Create agents with just a few lines of code
- **Tool System** - Define custom tools with Zod schemas
- **Streaming** - Real-time streaming responses
- **Session Management** - Multi-turn conversations with context
- **Auto Compact** - Automatic context compression
- **Error Recovery** - Built-in retry and fallback mechanisms
- **Query Tracking** - Debug and monitor query chains
- **TypeScript** - Full type safety

## Quick Example

```typescript
import { createAgent } from 'codenano'

const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
})

const result = await agent.ask('What is 2+2?')
console.log(result.text) // "2+2 = 4"
```

## Installation

```bash
npm install codenano
```

## Next Steps

- [Quick Start Guide](getting-started/quick-start.md)
- [Core Concepts](core-concepts/agent.md)
- [Examples](examples/basic.md)
