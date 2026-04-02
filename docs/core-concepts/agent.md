# Agent

An Agent is the main interface for interacting with Claude.

## Creating an Agent

```typescript
import { createAgent } from 'codenano'

const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are a helpful assistant.',
})
```

## Configuration Options

- `apiKey` - Anthropic API key
- `model` - Claude model (e.g., 'claude-sonnet-4-6')
- `systemPrompt` - Custom system prompt
- `tools` - Array of tools
- `maxTurns` - Maximum agent loop turns (default: 30)

## Methods

### ask(prompt)

Send a prompt and get the final result:

```typescript
const result = await agent.ask('What is 2+2?')
console.log(result.text)
console.log(result.queryTracking)
```

### stream(prompt)

Stream events in real-time:

```typescript
for await (const event of agent.stream('Count to 5')) {
  if (event.type === 'text') {
    process.stdout.write(event.text)
  }
}
```

### session()

Create a multi-turn session:

```typescript
const session = agent.session()
await session.send('My name is Alice')
await session.send('What is my name?')
```

## Next Steps

- [Session Management](session.md)
- [Tools](tools.md)
