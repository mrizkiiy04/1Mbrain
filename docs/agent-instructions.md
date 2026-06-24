# 1MBrain Agent Instructions & Integration Guide

Welcome, Autonomous Agents, AI Assistants (Cursor, Antigravity, Claude, Devin, etc.), and human developers! 
This is the single source of truth for integrating with the **1MBrain** memory engine.

## 1. The System Protocol

If you are an AI agent, you must follow these memory usage rules:

```text
You are equipped with 1MBrain, a highly advanced long-term memory engine. 
You have access to memory tools (e.g., `remember` and `recall`) to store and retrieve information across sessions.

CRITICAL INSTRUCTIONS FOR USING YOUR MEMORY:

1. ALWAYS SEARCH FIRST: Before asking the user for information you might already know, or before making assumptions, ALWAYS use the `recall` tool to search your memory.
2. PREFER SPECIFIC QUERIES: When using `recall`, use specific conceptual queries rather than vague keywords. (e.g., "user dietary restrictions" instead of "food").
3. RECORD NEW FACTS ACTIVELY: Whenever the user provides new, durable information (preferences, facts, state changes, or important events), immediately use the `remember` tool to store it. Do not ask for permission to remember.
4. DO NOT DELETE STALE FACTS: If the user changes their mind (e.g., "I used to like Apple, now I like Samsung"), simply `remember` the new fact. 1MBrain's chronological supersedence engine will automatically decay the old fact and prioritize the new one.
5. NO HALLUCINATION: If the `recall` tool returns nothing, admit you do not know the information. Do not invent past interactions.
6. USE URL INGESTION: If the user provides a link/URL for you to read, DO NOT manually fetch or extract the HTML. Use the `ingestUrl` tool/method provided by the SDK to hand the link to 1MBrain. 1MBrain will automatically fetch, clean, chunk, and store the facts for you.
7. CROSS-AGENT SEARCH: If you need to search for information across all agents (e.g. asking a global question or querying knowledge from another agent namespace), you can set `crossAgent: true` in your `recall` tool/method call. Use this sparingly when specifically instructed to do so.
8. EXPLICIT HISTORY MODE: By default, `recall` suppresses superseded/stale memories unless the user asks a historical question. If you specifically need only the absolute latest state, set `historyMode: 'latest'`. If you need to retrieve all historical contexts explicitly, set `historyMode: 'all'`.
```

---

## 2. Integration Methods

### A. MCP Server (For IDEs & Desktop Agents)

If you are running inside an environment that supports the Model Context Protocol (MCP), you can connect to 1MBrain locally without writing integration code.

**Setup in IDE (Cursor, Antigravity):**
Provide these environment variables:
- `ONEMBRAIN_API_URL` (e.g., `http://localhost:3000`)
- `ONEMBRAIN_API_KEY` (Your 1MBrain API Key)
- `ONEMBRAIN_DEFAULT_AGENT_ID` (Your specific namespace/agent ID)

Add the MCP server to your configuration:
```json
{
  "mcpServers": {
    "1mbrain": {
      "command": "npx",
      "args": ["-y", "@1mbrain/mcp-server"]
    }
  }
}
```

### B. TypeScript / Node.js SDK

**Installation:**
```bash
npm install @1mbrain/sdk
```

**Usage:**
```typescript
import { OneMBrainClient } from '@1mbrain/sdk';

const client = new OneMBrainClient({
  apiUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
  agentId: 'agent-123'
});

// Remember
await client.remember({
  content: 'User prefers dark mode',
  type: 'semantic',
  importance: 0.8
});

// Recall (Agent-specific)
const results = await client.recall({ query: 'UI preferences' });
if (results.confidence === 'low') {
  console.log("No relevant memory found.");
}

// Recall (Cross-Agent)
const globalResults = await client.recall({ query: 'System rules', crossAgent: true });
```

### C. Python SDK

**Installation:**
```bash
pip install onemillionbrain
```

**Usage:**
```python
from onemillionbrain import OneMBrainClient

client = OneMBrainClient(
    api_url="http://localhost:3000",
    api_key="your-api-key",
    agent_id="agent-123"
)

# Remember
client.remember(
    content="User prefers dark mode",
    memory_type="semantic"
)

# Recall
results = client.recall(query="UI preferences")
if not results:
    print("No relevant memory found.")
```

---

## 3. Working with Memory Quality & Hallucination Prevention

1MBrain uses an advanced "Evidence Quality Gate" to prevent AI agents from hallucinating when relevant memories aren't found.

### The `confidence` Signal
When calling the `/v1/memories/search` endpoint (or `client.recall()` via SDK), pay attention to the `meta` object in the response.

```json
{
  "success": true,
  "data": [],
  "meta": {
    "total": 0,
    "confidence": "low",
    "reason": "insufficient_evidence"
  }
}
```

If `confidence` is `"low"`, it means the engine found NO memories that pass the relevance threshold. 
**Agent Instruction:** If you receive a low confidence signal, **DO NOT invent an answer**. You should explicitly state: *"I don't have information about that in my memory."*

### Using the Hermes Adapter (TypeScript)
If you are using the `HermesMemoryAdapter` from `@1mbrain/sdk/hermes`, the `buildContext()` method automatically handles this for you. If confidence is low, it returns the explicit string `"I don't have information about that in my memory."` which you can inject directly into your LLM prompt.

---

## 4. Architecture & Troubleshooting

1MBrain is a Node.js-first backend. If you are trying to run the server, you must use Node.js (`npm run dev` in the `packages/api` directory).

- **Node.js (CommonJS vs ESM):** The `@1mbrain/sdk` exports both `.js` (ESM) and `.cjs` (CommonJS). You can safely `require('@1mbrain/sdk')`.
- **Health Check Endpoint:** The public health endpoint is located at `/health` (without the `/v1` prefix).
