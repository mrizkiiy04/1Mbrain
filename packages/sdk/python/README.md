# 1MBrain Python SDK

Python client for the [1MBrain](https://github.com/mrizkiiy04/1mbrain) REST API — a portable, semantic graph memory layer for AI agents.

## Installation

```bash
# Sync client (zero extra dependencies — uses stdlib urllib)
pip install onemillionbrain

# Async client (requires httpx)
pip install onemillionbrain[async]
```

## Quick Start

### Sync

```python
from onemillionbrain import OneMBrainClient

client = OneMBrainClient(
    api_url="http://localhost:3001",
    api_key="your-api-key",
    agent_id="my-agent",
)

# Store a memory
memory = client.remember("User prefers Bahasa Indonesia as primary language", type="semantic")
print(memory.id)

# Search memories
results = client.recall("language preference", limit=5)
for r in results:
    print(f"[{r.score:.3f}] {r.memory.content}")

# Create an explicit association
client.associate(results[0].memory.id, results[1].memory.id, strength=0.8)

# Forget a memory
client.forget(memory.id)
```

### Async

```python
import asyncio
from onemillionbrain import AsyncOneMBrainClient

async def main():
    async with AsyncOneMBrainClient(
        api_url="http://localhost:3001",
        api_key="your-api-key",
        agent_id="my-agent",
    ) as client:
        memory = await client.remember("User asked about pricing on 2026-06-10", type="episodic")
        results = await client.recall("pricing questions")
        await client.forget(memory.id)

asyncio.run(main())
```

### Agent Integration

To ensure your LLM agent knows exactly how and when to use 1MBrain, the SDK exports a pre-written `AGENT_SYSTEM_PROMPT`. Inject this into your agent's system instructions.

```python
from onemillionbrain import AGENT_SYSTEM_PROMPT

system_instruction = f"""
You are a helpful AI assistant.
{AGENT_SYSTEM_PROMPT}
"""

# Pass system_instruction to LangChain, OpenAI, Anthropic, etc.
```

### LangChain Integration

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
    return f"Stored memory: {memory.id}"

@tool
def recall_tool(query: str) -> str:
    """Search long-term memory."""
    results = brain.recall(query, limit=5)
    if not results:
        return "No memories found."
    return "\n".join(f"- {r.memory.content}" for r in results)
```

## API Reference

### `OneMBrainClient(api_url, api_key, agent_id=None)`

| Parameter  | Type  | Description                                            |
|------------|-------|--------------------------------------------------------|
| `api_url`  | `str` | Base URL of the 1MBrain API (e.g. `http://localhost:3001`) |
| `api_key`  | `str` | Your API key (passed as `X-API-Key` header)            |
| `agent_id` | `str` | Default agent namespace (can be overridden per call)   |

### Methods

| Method | Signature | Returns |
|--------|-----------|---------|
| `remember` | `(content, *, type, importance, tags, metadata, agent_id)` | `Memory` |
| `recall` | `(query, *, limit, type, tags, max_hops, activation_threshold, blend_weight, agent_id, cross_agent)` | `list[RecallResult]` |
| `forget` | `(memory_id, *, agent_id)` | `bool` |
| `associate` | `(source_id, target_id, *, strength, origin, agent_id)` | `AssociateResult` |

## Development

```bash
pip install -e ".[dev]"
pytest
```
