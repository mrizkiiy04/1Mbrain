# SDK Quickstart — Integrate 1MBrain in Under 30 Minutes

> **Goal:** From zero to a working `remember()` → `recall()` flow in your agent.  
> Works with any agent: LangChain, LlamaIndex, custom Python/TypeScript scripts, or Hermes.

---

## Prerequisites

- 1MBrain API server running (locally or self-hosted)
- An API key (generated via the 1MBrain admin or your `.env` config)
- Node.js ≥ 18 **or** Python ≥ 3.10

---

## Step 1 — Start the API Server (2 min)

```bash
# Clone the repo and start everything with Docker Compose
git clone https://github.com/mrizkiiy04/1mbrain.git
cd 1mbrain
cp .env.example .env           # fill in EMBEDDING_PROVIDER and API_KEY_SECRET
docker compose up -d           # starts API + Redis + SQLite
```

Health check:
```bash
curl http://localhost:3001/health
# → {"status":"ok"}
```

Your API is now running at `http://localhost:3001`.

---

## Step 2 — Install the SDK (1 min)

### TypeScript / Node.js

```bash
npm install @1mbrain/sdk
```

### Python

```bash
pip install onemillionbrain            # sync client (no extra deps)
pip install onemillionbrain[async]     # + async support via httpx
```

---

## Step 3 — Configure the Client (2 min)

### TypeScript

```ts
import { OneMBrainClient } from '@1mbrain/sdk';

const brain = new OneMBrainClient({
  apiUrl: process.env.ONEMILLION_API_URL ?? 'http://localhost:3001',
  apiKey: process.env.ONEMILLION_API_KEY!,
  agentId: 'my-agent-bot',   // Namespace: each agent/bot gets its own isolated memory database
});
```

> [!TIP]
> **Understanding Agent Namespaces (`agentId`)**
> 
> The `agentId` acts as a partition key. All memories stored with a specific `agentId` are isolated from others.
> - For user-specific memories (e.g. in Telegram/Discord bots), you can set `agentId` dynamically to `'telegram-user-' + userId`.
> - For separate agents in a multi-agent network (e.g. LangChain, CrewAI), set `agentId` to each agent's role (e.g. `'writer-agent'`, `'researcher-agent'`).

### Python

```python
from onemillionbrain import OneMBrainClient

brain = OneMBrainClient(
    api_url="http://localhost:3001",
    api_key="your-api-key",
    agent_id="my-agent-bot",
)
```

---

## Step 4 — Your First `remember()` (1 min)

### TypeScript

```ts
const memory = await brain.remember({
  content: 'User prefers Bahasa Indonesia as the primary language.',
  type: 'semantic',        // episodic | semantic | procedural
  importance: 0.9,
  tags: ['preference', 'language'],
});

console.log('Stored:', memory.id);
```

### Python

```python
memory = brain.remember(
    "User prefers Bahasa Indonesia as the primary language.",
    type="semantic",
    importance=0.9,
    tags=["preference", "language"],
)
print("Stored:", memory.id)
```

---

## Step 5 — Your First `recall()` (1 min)

### TypeScript

```ts
const results = await brain.recall({ query: 'language preference', limit: 5 });

for (const { memory, score } of results) {
  console.log(`[${score.toFixed(3)}] ${memory.content}`);
}
```

### Python

```python
results = brain.recall("language preference", limit=5)

for r in results:
    print(f"[{r.score:.3f}] {r.memory.content}")
```

---

## Step 6 — Optional: Create Associations (2 min)

Manually link two memories to strengthen their relationship in the graph:

### TypeScript

```ts
const a = await brain.remember({ content: 'User asked about VibeAman pricing', type: 'episodic' });
const b = await brain.remember({ content: 'VibeAman pricing: Rp 150k/month', type: 'semantic' });

await brain.associate(a.id, { targetId: b.id, strength: 0.9 });
// Now when you recall 'pricing', both memories surface together
```

### Python

```python
a = brain.remember("User asked about VibeAman pricing", type="episodic")
b = brain.remember("VibeAman pricing: Rp 150k/month", type="semantic")

brain.associate(a.id, b.id, strength=0.9)
```

---

## Step 7 — `forget()` When You're Done (30 sec)

```ts
await brain.forget(memory.id);
```

```python
brain.forget(memory.id)
```

---

## Framework Integration Examples

### LangChain (Python)

```python
from langchain.tools import tool
from onemillionbrain import OneMBrainClient

brain = OneMBrainClient(
    api_url="http://localhost:3001",
    api_key="your-api-key",
    agent_id="langchain-agent",
)

@tool
def remember_tool(content: str) -> str:
    """Store something in long-term memory."""
    memory = brain.remember(content, type="episodic")
    return f"Stored: {memory.id}"

@tool
def recall_tool(query: str) -> str:
    """Retrieve relevant memories."""
    results = brain.recall(query, limit=5)
    if not results:
        return "No memories found."
    return "\n".join(f"- {r.memory.content}" for r in results)
```

### LlamaIndex (Python)

```python
from llama_index.core.tools import FunctionTool
from onemillionbrain import OneMBrainClient

brain = OneMBrainClient(
    api_url="http://localhost:3001",
    api_key="your-api-key",
    agent_id="llamaindex-agent",
)

remember_tool = FunctionTool.from_defaults(
    fn=lambda content: brain.remember(content, type="episodic").id,
    name="remember",
    description="Store a fact in long-term memory. Returns the memory ID.",
)

recall_tool = FunctionTool.from_defaults(
    fn=lambda query: [r.memory.content for r in brain.recall(query, limit=5)],
    name="recall",
    description="Search long-term memory. Returns a list of relevant memory strings.",
)
```

### Hermes Agent (TypeScript)

> [!NOTE]
> **Convenience Wrapper Example:**
> The `HermesMemoryAdapter` is a specialized convenience wrapper for the Hermes framework. It serves as an blueprint for how you can write custom framework adapters for any agent system. If you are not using Hermes, use the generic `OneMBrainClient` (see the Custom Agent example below).

```ts
import { HermesMemoryAdapter } from '@1mbrain/sdk/hermes';

const memory = new HermesMemoryAdapter({
  apiUrl: process.env.ONEMILLION_API_URL!,
  apiKey: process.env.ONEMILLION_API_KEY!,
  agentId: 'hermes-agent-1',
});

// After each conversation turn:
await memory.rememberTurn({
  userMessage: userInput,
  assistantReply: agentResponse,
  topics: ['pricing', 'vibeaman'],
});

// Inject context before the next LLM call:
const ctx = await memory.buildContext(userInput);
systemPrompt = `${baseSystemPrompt}\n\n${ctx}`;
```

### Custom Agent (TypeScript)

```ts
import { OneMBrainClient } from '@1mbrain/sdk';

const brain = new OneMBrainClient({
  apiUrl: 'http://localhost:3001',
  apiKey: 'your-api-key',
  agentId: 'my-custom-agent',
});

async function processUserInput(input: string) {
  // 1. Recall relevant context
  const relevant = await brain.recall({ query: input, limit: 5, maxHops: 2 });
  
  // 2. Build context string
  const context = relevant
    .map(r => `- ${r.memory.content}`)
    .join('\n');

  // 3. Call LLM with memory context
  const reply = await callLLM(`Context:\n${context}\n\nUser: ${input}`);

  // 4. Store the interaction as episodic memory
  await brain.remember({
    content: `User: ${input}\nAssistant: ${reply}`,
    type: 'episodic',
    tags: ['conversation'],
  });

  return reply;
}
```

---

## Spreading Activation (Advanced)

For richer, more human-like recall, enable spreading activation:

```ts
const results = await brain.recall({
  query: 'tell me about VibeAman',
  limit: 10,
  maxHops: 3,              // walk up to 3 hops in the association graph
  activationThreshold: 0.3, // minimum activation score to include a node
  blendWeight: 0.4,         // 40% graph score, 60% vector score
});
```

```python
results = brain.recall(
    "tell me about VibeAman",
    limit=10,
    max_hops=3,
    activation_threshold=0.3,
    blend_weight=0.4,
)
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `401 Unauthorized` | Check `X-API-Key` header — make sure your `api_key` matches the server config |
| `No memories found` | Try a broader query, or lower `activationThreshold` |
| Embeddings mismatch on import | Set the same `EMBEDDING_PROVIDER` env var — or use the export/import endpoints which re-embed automatically |
| Redis not available | The API falls back to in-memory pub/sub automatically; the dashboard stream still works |
| `agent_id is required` | Pass `agentId` in the constructor or per-call options |

---

## Next Steps

- 📊 Open the [Pulse Brain Dashboard](http://localhost:3000) to watch memory activity in real time  
- 💾 [Export a Memory Passport](../api/export.md) to back up or migrate agent memory  
- 🔗 [POST /v1/memories/:id/associate](../api/associate.md) to manually link memories  
- ☁️ [Set up Google Drive backup](../api/backup.md) for automated snapshots
