# 1MBrain Agent Integration Guide

Welcome, Autonomous Agents and Developers! 
This guide is specifically designed to help AI Assistants (like Hermes, Devin, Claude, etc.) and human developers integrate with the **1MBrain** memory engine smoothly.

## 1. Architecture Overview

1MBrain consists of three main components:
1. **Core Engine (`@1mbrain/core`)**: The pure TypeScript engine handling SQLite operations, vector math, and spreading activation.
2. **API Server (`@1mbrain/api`)**: A Node.js/Hono REST API server that exposes the core engine over HTTP.
3. **SDKs**:
   - **TypeScript (`@1mbrain/sdk`)**: For Node.js/Edge environments.
   - **Python (`onemillionbrain`)**: A Python wrapper and local HTTP proxy.

> [!IMPORTANT]
> **1MBrain is a Node.js-first backend.** If you are trying to run the server, you must use Node.js (`npm run dev` or `npm start` in the `packages/api` directory). The Python package provides a CLI (`1mbrain-server`) that proxies to the Node API, but the core engine runs in Node/SQLite.

---

## 2. Common Pitfalls & Troubleshooting

### Node.js (CommonJS vs ESM)
**Problem:** In the past, `@1mbrain/sdk` only exported ESM, causing `ERR_PACKAGE_PATH_NOT_EXPORTED` in CommonJS environments (like standard Node.js).
**Solution:** This has been fixed! The SDK now uses `tsup` to export both `.js` (ESM) and `.cjs` (CommonJS). You can safely `require('@1mbrain/sdk')`.

### Python Server Crash silently
**Problem:** Early versions of the Python proxy (`server.py`) used `self.request.read()` instead of `self.rfile.read()`, causing silent crashes on POST requests.
**Solution:** This is fixed in `packages/sdk/python/src/onemillionbrain/server.py`. Ensure you are using the latest version. If you are building a custom Python wrapper, always use `self.rfile.read()` to read the POST body.

### Health Check Endpoint
**Problem:** Some orchestration systems ping `/v1/health` and get a 401 Unauthorized because the auth middleware blocks it.
**Solution:** The public health endpoint is located at `/health` (without the `/v1` prefix). Make sure your readiness probes point to `/health`.

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

### Using the Hermes Adapter
If you are using the `HermesMemoryAdapter` from `@1mbrain/sdk/hermes`, the `buildContext()` method automatically handles this for you. If confidence is low, it returns the explicit string `"I don't have information about that in my memory."` which you can inject directly into your LLM prompt.

---

## 4. Code Examples

### TypeScript (Generic)

**Installation:**
```bash
npm install @1mbrain/sdk
```

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

// Recall
const results = await client.recall({ query: 'UI preferences' });
if (results.confidence === 'low') {
  console.log("No relevant memory found.");
}

// Ingest URL (Auto-fetch, chunk, and store)
const ingestResult = await client.ingestUrl({ url: 'https://kompas.com/tech' });
console.log(`Stored ${ingestResult.storedCount} facts!`);
```

### Python

**Installation:**
```bash
pip install onemillionbrain
```

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

# Ingest URL (Auto-fetch, chunk, and store)
ingest_result = client.ingest_url("https://kompas.com/tech")
print(f"Stored {ingest_result['storedCount']} facts!")
```

## 5. Contact & Contribution
If you encounter an error that isn't listed here, verify the repository's documentation or agent instructions.
