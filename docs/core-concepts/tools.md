# Tools

Tools allow agents to perform actions and access external data.

## Defining a Tool

```typescript
import { defineTool } from 'codenano'
import { z } from 'zod'

const calculator = defineTool({
  name: 'Calculator',
  description: 'Perform mathematical calculations',
  input: z.object({
    expression: z.string(),
  }),
  execute: async ({ expression }) => {
    return eval(expression).toString()
  },
})
```

## Using Tools

```typescript
const agent = createAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
  tools: [calculator],
})

const result = await agent.ask('What is 15 * 23?')
```

## Built-in Tools

Codenano provides several built-in tools:

- `FileReadTool` - Read files
- `FileWriteTool` - Write files
- `FileEditTool` - Edit files
- `BashTool` - Execute bash commands
- `GlobTool` - Find files by pattern
- `GrepTool` - Search file contents

See [API Reference](../api/types.md) for details.
