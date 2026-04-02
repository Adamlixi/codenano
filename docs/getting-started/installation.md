# Installation

## Requirements

- Node.js >= 18
- npm or yarn

## Install

```bash
npm install codenano
```

## Setup API Key

```bash
export ANTHROPIC_API_KEY=your_key_here
```

Or use `.env` file:

```
ANTHROPIC_API_KEY=your_key_here
```

## Verify Installation

```typescript
import { createAgent } from 'codenano'

const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
})

const result = await agent.ask('Hello!')
console.log(result.text)
```

## Next Steps

- [Quick Start](quick-start.md)
