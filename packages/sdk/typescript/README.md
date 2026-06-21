# @1mbrain/sdk

The official TypeScript/Node.js client for [1MBrain](https://github.com/mrizkiiy04/1mbrain) — a portable, semantic graph memory layer for AI agents.

## Installation

```bash
npm install @1mbrain/sdk
# or
yarn add @1mbrain/sdk
# or
pnpm add @1mbrain/sdk
```

## Quick Start

```typescript
import { OneMBrainClient } from '@1mbrain/sdk';

// Initialize the client
const brain = new OneMBrainClient({
  apiUrl: 'http://localhost:3100', // URL to your 1MBrain API instance
  apiKey: 'your-api-key',          // Provide your configured API key
  agentId: 'my-assistant-bot',     // Namespace: each agent/bot gets isolated memory
});

async function main() {
  // 1. Store a memory
  const memory = await brain.remember({
    type: 'semantic',
    content: 'User prefers Bahasa Indonesia as primary language',
    importance: 0.9,
    tags: ['preference', 'language'],
  });
  console.log('Stored memory ID:', memory.id);

  // 2. Recall memories
  const results = await brain.recall({
    query: 'what language does the user prefer?',
    limit: 5,
    useSpreadingActivation: true,
  });
  
  results.forEach(r => console.log(`[${r.score.toFixed(3)}] ${r.memory.content}`));

  // 3. Create an explicit association between memories
  if (results.length > 1) {
    await brain.associate(memory.id, {
      targetId: results[1].memory.id,
      strength: 0.8,
    });
  }

  // 4. Forget a memory
  // await brain.forget(memory.id);
}

main().catch(console.error);
```

## Agent Integration

To ensure your LLM agent knows exactly how and when to use 1MBrain, the SDK exports a pre-written `AGENT_SYSTEM_PROMPT`. You should inject this into your agent's system instructions.

```typescript
import { AGENT_SYSTEM_PROMPT } from '@1mbrain/sdk';

const systemInstruction = `
You are a helpful AI assistant.
${AGENT_SYSTEM_PROMPT}
`;

// Pass systemInstruction to LangChain, OpenAI, Claude, etc.
```

## API Reference

### `OneMBrainClient(config)`

Configuration options:
- `apiUrl` (string): Base URL of the 1MBrain API.
- `apiKey` (string): Your API key for authentication.
- `agentId` (string, optional): Default agent namespace. Can be overridden in individual method calls.

### Methods

| Method | Parameters | Returns |
|--------|------------|---------|
| `remember(input)` | `{ type, content, importance?, tags?, metadata?, agentId? }` | `Promise<Memory>` |
| `recall(input)` | `{ query, limit?, type?, tags?, maxHops?, activationThreshold?, blendWeight?, agentId? }` | `Promise<RecallResult[]>` |
| `forget(id, options?)` | `id` (string), `options?: { agentId? }` | `Promise<boolean>` |
| `associate(sourceId, params)` | `sourceId` (string), `params: { targetId, strength, origin?, agentId? }` | `Promise<Association>` |

## Error Handling

The client throws `OneMBrainError` on API failures. You can catch these to handle specific HTTP status codes or error messages gracefully.

## License

MIT
