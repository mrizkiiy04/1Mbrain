# Multi-Gateway Integration & User Isolation

AI agents often interact with users across multiple gateways: Telegram chats, Discord channels, Slack groups, web apps, or CLI interfaces. 

1MBrain is designed from the ground up as a **framework-agnostic backend**. This guide explains how to design isolated memory namespaces (`agentId`) so that your agents remain context-aware, secure, and performant across all platforms.

---

## 1. Designing Your Namespaces (`agentId`)

The `agentId` (sent via the `X-Agent-Id` header in HTTP or specified in the SDK clients) is a partition key. All operations (`remember`, `recall`, `forget`, `ingestUrl`) are scoped to this identifier. 

To isolate memories, format the `agentId` based on your product requirements:

### A. User-Isolated Memory (Personal Assistant)
Each user has their own isolated brain. The agent forgets what it talked about with User A when talking to User B.

*   **Telegram:** `telegram-user-${tg_user_id}`
*   **Discord:** `discord-user-${discord_user_id}`
*   **Web App:** `webapp-user-${database_user_uuid}`

*Example Usage (TypeScript):*
```typescript
// On message received:
const agentId = `telegram-user-${ctx.from.id}`;
const userMemory = new OneMBrainClient({ apiUrl, apiKey, agentId });
```

### B. Channel / Group-Shared Memory (Collab Agent)
All users in a specific chat room, channel, or server share the same brain. The agent can remember a URL or a preference shared by one user and apply it to another user in that same room.

*   **Telegram Group:** `telegram-group-${tg_chat_id}`
*   **Discord Channel:** `discord-channel-${discord_channel_id}`
*   **Slack Channel:** `slack-channel-${slack_channel_id}`

### C. Globally Shared Agent Memory
The agent acts as a company representative or a global helper. It shares the same set of facts and procedures across all users and channels.

*   **Global ID:** `customer-support-agent`

---

## 2. Ingesting & Recalling Memory in Bot Workflows

Here is the standard workflow for an agent processing a user query:

```
[ User asks: "what was the price of the product we learned earlier?" ]
                                  ↓
      [ 1. Retrieve the correct agentId for this chat channel ]
                                  ↓
       [ 2. Call brain.recall({ query: user_query, limit: 5 }) ]
                                  ↓
    [ 3. Construct prompt: combine recalled context + system prompt ]
                                  ↓
                  [ 4. Send combined prompt to LLM ]
                                  ↓
         [ 5. LLM generates answer based on recalled facts ]
                                  ↓
         [ 6. Save new turn: brain.remember({ content: ... }) ]
                                  ↓
                 [ 7. Send response back to user ]
```

### Reference Implementation: Multi-Gateway Bot Middleware

This is a clean pattern for managing memory in a Node-based bot gateway framework:

```typescript
import { OneMBrainClient } from '@1mbrain/sdk';

const brainClient = new OneMBrainClient({
  apiUrl: process.env.ONEMILLION_API_URL!,
  apiKey: process.env.ONEMILLION_API_KEY!,
});

/**
 * Orchestrates memory retrieval, prompt injection, and memory storage.
 * Works for Telegram, Discord, Slack, or Web Chat.
 */
export async function handleAgentChat(options: {
  gateway: 'telegram' | 'discord' | 'slack';
  channelId: string;
  userId: string;
  userMessage: string;
  systemPromptBase: string;
  callLLM: (prompt: string) => Promise<string>;
}) {
  // 1. Choose isolation strategy (here, channel-shared memory)
  const agentId = `${options.gateway}-channel-${options.channelId}`;

  // 2. Recall relevant context from 1MBrain
  const memories = await brainClient.recall({
    query: options.userMessage,
    agentId,
    limit: 5,
    useSpreadingActivation: true,
  });

  // 3. Format the recalled facts into markdown
  const contextBlock = memories.length > 0 
    ? [
        "### RECALLED LONG-TERM MEMORY",
        "Here are relevant facts and prior conversations. Use them to answer accurately:",
        ...memories.map(r => `- [${r.memory.type}] ${r.memory.content}`),
        ""
      ].join("\n")
    : "";

  // 4. Inject into the prompt
  const finalPrompt = [
    options.systemPromptBase,
    "",
    contextBlock,
    `User: ${options.userMessage}`,
    "Assistant:"
  ].join("\n");

  // 5. Generate assistant response from LLM
  const assistantReply = await options.callLLM(finalPrompt);

  // 6. Record the exchange in long-term memory (Episodic)
  await brainClient.remember({
    agentId,
    type: 'episodic',
    content: `User: ${options.userMessage}\nAssistant: ${assistantReply}`,
    importance: 0.6,
    tags: ['conversation', options.gateway]
  });

  return assistantReply;
}
```

---

## 3. Best Practices for Production Gateways

### A. Memory Pruning & Clean Up
If you use user-isolated databases (`telegram-user-XYZ`), you may end up with many namespaces.
*   **Decay:** 1MBrain handles decay scores automatically. Use the decay system to identify stale nodes.
*   **Retention Policies:** Set up scheduled jobs using `brain.forget(id)` on low-importance/decayed memories if needed.

### B. Sensitive Data Filtering
Web page ingestion or raw conversation logs might accidentally record credentials, passwords, or personal identifiable information (PII).
*   Always enable `deduplicate: true` during URL ingestion to avoid repeating facts.
*   Implement client-side sanitization before calling `remember()`. See the filter guidelines in [Page Ingestion Guide](./page-ingestion.md).

### C. Combining Context Sources
In a production assistant, memory is only one source. You should combine:
1.  **System Prompt:** Core personality and instructions.
2.  **Recall Context:** Semantic facts retrieved from 1MBrain.
3.  **Short-Term Window:** The raw transcript of the last 3-5 chat messages.
