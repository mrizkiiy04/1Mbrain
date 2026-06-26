# Web Page Ingestion Pipeline

The ingestion pipeline accepts either a URL or trusted, already-clean Markdown. It extracts, validates, and stores **only clean, factual claims** as structured memories.

Sources are deduplicated server-side by `(agentId, sourceHash)`. A processing lease prevents parallel ingestion; a source that stores no facts or encounters an error is released so it can be retried.

---

## How It Works

```
                        [ User sends URL ]
                                ↓
                      [ Agent / Gateway Bot ]
                                ↓ (calls SDK or HTTP API)
                      [ POST /v1/ingest/url ]
                                ↓
      ┌──────────────────────────────────────────────────┐
      │             SERVER-SIDE PIPELINE                 │
      ├──────────────────────────────────────────────────┤
      │  1. Fetch Page HTML (with timeout & redirects)    │
      │  2. Extract Main Content (@mozilla/readability)  │
      │  3. Convert HTML → Clean Markdown (Turndown)     │
      │  4. Normalize & Strip CTA/Ads/Cookie Notices     │
      │  5. Chunk Markdown (e.g. max 1800 characters)     │
      │  6. LLM Fact Extraction (confidence threshold)    │
      │  7. Ledger Deduplication (skips if already seen) │
      └──────────────────────────────────────────────────┘
                                ↓
                     [ N × POST /v1/memories ]
                                ↓
                 [ Vector Store + SQLite/Postgres ]
```

### 1. Ingestion Pipeline Steps
1. **Fetcher:** Safely downloads the URL content with timeout controls, redirects tracking, and non-HTML content rejection.
2. **Extractor:** Isolates the core article body using Mozilla Readability and converts the HTML tree into structural Markdown.
3. **Cleaner:** Strips advertisements, social media share prompts, cookies policies, sign-up forms, and other noise.
4. **Chunker:** Splits clean Markdown into semantically cohesive paragraphs without tearing sentences.
5. **Fact Extractor:** Runs a configured LLM (GPT-4o-mini or Ollama) to extract distinct, evidentiary factual claims. If confidence is below `0.75` (default), the claim is skipped.
6. **Deduplicator:** Persists a hash of the URL + content in the `Source Ledger`. If the exact same page contents are ingested again, the pipeline skips processing, preventing duplicated memory noise.

---

## Configuration

To enable fact extraction, configure the LLM provider in your server `.env` file:

```bash
# Dedicated fact extraction provider (falls back to EMBEDDING_PROVIDER)
INGEST_FACT_EXTRACTION_PROVIDER="openai" # 'openai' or 'ollama'
INGEST_FACT_EXTRACTION_MODEL="gpt-4o-mini"
INGEST_FACT_EXTRACTION_API_KEY="your-api-key" # optional fallback: OPENAI_API_KEY
INGEST_FACT_EXTRACTION_BASE_URL="https://api.openai.com" # optional

# If using OpenAI
OPENAI_API_KEY="your-openai-api-key"
OPENAI_BASE_URL="https://api.openai.com/v1" # optional override

# If using Ollama
OLLAMA_BASE_URL="http://localhost:11434"

# Optional Model Overrides
# Default OpenAI: 'gpt-4o-mini'
# Default Ollama: 'llama3' (or 'llama3.1', etc.)
INGEST_FACT_EXTRACTION_MODEL="gpt-4o-mini"
```

---

## SDK Usage

### TypeScript SDK

Use the `OneMBrainClient.ingestUrl` method. It is gateway-agnostic and partitions memories under the specified `agentId`.

```typescript
import { OneMBrainClient } from '@1mbrain/sdk';

const brain = new OneMBrainClient({
  apiUrl: 'http://localhost:3001',
  apiKey: 'your-api-key',
  agentId: 'telegram-assistant-bot',
});

// Ingest a URL
const result = await brain.ingestUrl('https://example.com/ai-news', {
  confidenceThreshold: 0.80, // strict filtering
  deduplicate: true,         // skip if already ingested
});

console.log(`Learned ${result.storedCount} facts from "${result.title}"`);
console.log(`Skipped ${result.skippedCount} low-confidence facts.`);
console.log('Stored Memory IDs:', result.memoryIds);
```

### Python SDK

```python
from onemillionbrain import OneMBrainClient

brain = OneMBrainClient(
    api_url="http://localhost:3001",
    api_key="your-api-key",
    agent_id="discord-bot-channel-1"
)

# Sync ingest
result = brain.ingest_url(
    "https://example.com/ai-news",
    confidence_threshold=0.80,
    deduplicate=True
)

print(f"Ingested: {result.title}")
print(f"Stored facts count: {result.stored_count}")
```

---

## HTTP REST API

### Ingest a URL

* **URL:** `POST /v1/ingest/url`
* **Headers:**
  * `X-API-Key: <key>`
  * `X-Agent-Id: <agent-namespace>`
* **Body:**

```json
{
  "url": "https://example.com/ai-news",
  "agentId": "custom-agent-1",
  "confidenceThreshold": 0.75,
  "maxChunkChars": 1800,
  "deduplicate": true
}
```

* **Response (`201 Created` or `200 OK` if deduplicated):**

```json
{
  "success": true,
  "data": {
    "title": "AI Breakthrough in Associative Memory",
    "url": "https://example.com/ai-news",
    "sourceHash": "a2c7e098ffb19b...",
    "chunkCount": 3,
    "extractedCount": 6,
    "storedCount": 4,
    "skippedCount": 2,
    "errorCount": 0,
    "deduplicated": false,
    "memoryIds": [
      "mem_01h2a...",
      "mem_01h2b..."
    ]
  }
}
```

### Check Ingestion Status (Deduplication Check)

### Ingest trusted Markdown

* **URL:** `POST /v1/ingest/markdown`
* **Body:**

```json
{
  "title": "Weekly Research Digest",
  "url": "urn:document:weekly-research-digest",
  "markdown": "# Digest\nVerified findings...",
  "confidenceThreshold": 0.75,
  "deduplicate": true
}
```

Use this endpoint only for content that is already available and trusted. Use
`POST /v1/ingest/url` when the source is a URL that the server must fetch.

Before launching a fetch, you can compute a hash or query the ledger to check if a source URL is already ingested.

* **URL:** `GET /v1/ingest/status/:sourceHash`
* **Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "seen": true,
    "url": "https://example.com/ai-news",
    "title": "AI Breakthrough in Associative Memory",
    "storedAt": "2026-06-18T10:00:00.000Z",
    "factCount": 4
  }
}
```

---

## Gateway Examples

Here is how you can use the URL ingestion capability in popular bot gateways:

### 1. Telegram Bot (Node.js)

```javascript
import { OneMBrainClient } from '@1mbrain/sdk';
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const brain = new OneMBrainClient({
  apiUrl: 'http://localhost:3001',
  apiKey: process.env.ONEMILLION_API_KEY,
});

bot.command('learn', async (ctx) => {
  const url = ctx.message.text.split(' ')[1];
  if (!url) {
    return ctx.reply('Usage: /learn <url>');
  }

  // Use the chat ID as the agentId namespace!
  // This gives this specific Telegram chat its own private long-term memory
  const agentId = `telegram-chat-${ctx.chat.id}`;

  await ctx.reply('📥 Fetching and studying web page...');

  try {
    const result = await brain.ingestUrl(url, { agentId });
    
    if (result.deduplicated) {
      return ctx.reply(`🧠 I already know this page! I have access to the facts from "${result.title}".`);
    }

    ctx.reply(`✅ Finished learning! I extracted and remembered ${result.storedCount} new facts from "${result.title}".`);
  } catch (err) {
    ctx.reply(`❌ Failed to ingest URL: ${err.message}`);
  }
});
```

### 2. Discord Bot (Python)

```python
import discord
from discord.ext import commands
from onemillionbrain import OneMBrainClient

bot = commands.Bot(command_prefix="!", intents=discord.Intents.all())
brain = OneMBrainClient(
    api_url="http://localhost:3001",
    api_key="your-api-key"
)

@bot.command()
async def learn(ctx, url: str):
    # Partition memory per channel so the bot has contextual channel memory
    agent_id = f"discord-channel-{ctx.channel.id}"
    
    await ctx.send("📥 Reading page and extracting knowledge...")
    
    try {
        # Using the async client is recommended in discord.py
        # or run in executor to prevent blocking
        result = brain.ingest_url(url, agent_id=agent_id)
        
        if result.deduplicated:
            await ctx.send(f"🧠 Already known! Facts from '{result.title}' are active in this channel.")
        else:
            await ctx.send(f"✅ Stored {result.stored_count} facts from '{result.title}'.")
    except Exception as e:
        await ctx.send(f"❌ Error: {str(e)}")
```
