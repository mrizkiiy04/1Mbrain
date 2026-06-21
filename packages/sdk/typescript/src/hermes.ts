/**
 * @1mbrain/hermes-adapter
 *
 * NOTE: This is an optional convenience wrapper tailored specifically for the Hermes 
 * agent framework. It serves as a reference/blueprint. For other frameworks or gateways, 
 * use the generic `OneMBrainClient` directly from '@1mbrain/sdk'.
 *
 * Hermes context objects are automatically mapped to the correct 1MBrain memory type, 
 * importance score, and metadata tags, so you never have to think about them in your 
 * agent code.
 *
 * Quick start:
 *
 * ```ts
 * import { HermesMemoryAdapter } from '@1mbrain/sdk/hermes';
 *
 * const memory = new HermesMemoryAdapter({
 *   apiUrl: process.env.ONEMILLION_API_URL!,
 *   apiKey: process.env.ONEMILLION_API_KEY!,
 *   agentId: 'hermes-agent-1',     // your instance name/namespace
 *   defaultImportance: 0.6,
 * });
 *
 * // Store an episodic memory from a conversation turn
 * await memory.rememberTurn({
 *   userMessage: "What is VibeAman pricing?",
 *   assistantReply: "VibeAman starts at Rp 150k/month.",
 * });
 *
 * // Store a persistent user preference
 * await memory.rememberPreference('preferred_language', 'Bahasa Indonesia');
 *
 * // Store a procedural pattern
 * await memory.rememberProcedure('push_to_github', 'Create PRD → push markdown deliverable');
 *
 * // Recall with automatic context enrichment
 * const results = await memory.recall('pricing');
 * ```
 */

import { OneMBrainClient } from './index.js';
import type { AssociateInput, Memory, SearchResult } from './index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HermesMemoryAdapterConfig {
  apiUrl: string;
  apiKey: string;
  agentId?: string;
  /** Default importance score for new memories (0–1). Defaults to 0.6. */
  defaultImportance?: number;
  /** Custom fetch implementation (useful in Cloudflare Workers / Edge). */
  fetch?: typeof fetch;
}

export interface HermesTurn {
  /** The raw user message from the current conversation turn. */
  userMessage: string;
  /** The assistant reply that was generated for this turn. */
  assistantReply?: string;
  /** Optional topic tags to attach to this episodic memory. */
  topics?: string[];
  /** Optional conversation / session ID for grouping. */
  sessionId?: string;
}

export interface HermesRecallOptions {
  /** Maximum number of results (default: 8). */
  limit?: number;
  /**
   * Restrict recall to a specific memory type.
   * When omitted, all types are searched.
   */
  type?: 'episodic' | 'semantic' | 'procedural' | 'entity' | 'warning';
  /** Filter by tags. */
  tags?: string[];
  /** Number of graph hops for spreading activation (default: 2). */
  maxHops?: number;
  /**
   * If provided, override the default agentId for this call.
   * Useful when querying another Hermes instance's memory.
   */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class HermesMemoryAdapter {
  private readonly client: OneMBrainClient;
  private readonly defaultImportance: number;
  private readonly agentId?: string;

  constructor(config: HermesMemoryAdapterConfig) {
    this.client = new OneMBrainClient({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      agentId: config.agentId,
      fetch: config.fetch,
    });
    this.defaultImportance = config.defaultImportance ?? 0.6;
    this.agentId = config.agentId;
  }

  // ------------------------------------------------------------------
  // Specialised remember helpers
  // ------------------------------------------------------------------

  /**
   * Store a conversation turn as an episodic memory.
   * The content is formatted as a Q&A pair for rich recall later.
   */
  async rememberTurn(turn: HermesTurn, agentId?: string): Promise<Memory> {
    const content = turn.assistantReply
      ? `User: ${turn.userMessage}\nHermes: ${turn.assistantReply}`
      : `User: ${turn.userMessage}`;

    const tags = ['episodic', 'conversation-turn', ...(turn.topics ?? [])];
    if (turn.sessionId) tags.push(`session:${turn.sessionId}`);

    return this.client.remember({
      content,
      type: 'episodic',
      importance: this.defaultImportance,
      tags,
      agentId,
    });
  }

  /**
   * Store a durable user preference as a semantic memory.
   * Semantic memories don't decay as fast and are weighted higher on recall.
   */
  async rememberPreference(key: string, value: string, agentId?: string): Promise<Memory> {
    return this.client.remember({
      content: `User preference — ${key}: ${value}`,
      type: 'semantic',
      importance: 0.85,
      tags: ['semantic', 'preference', `pref:${key}`],
      agentId,
    });
  }

  /**
   * Store a learned behavioural pattern or workflow as a procedural memory.
   * Procedural memories carry high importance by default.
   */
  async rememberProcedure(name: string, pattern: string, agentId?: string): Promise<Memory> {
    return this.client.remember({
      content: `Procedure — ${name}: ${pattern}`,
      type: 'procedural',
      importance: 0.9,
      tags: ['procedural', 'workflow', `proc:${name}`],
      agentId,
    });
  }

  /**
   * General-purpose remember — uses sensible Hermes defaults.
   * Delegates directly to the underlying SDK client.
   */
  async remember(
    content: string,
    options: {
      type?: 'episodic' | 'semantic' | 'procedural';
      importance?: number;
      tags?: string[];
      agentId?: string;
    } = {},
  ): Promise<Memory> {
    return this.client.remember({
      content,
      type: options.type ?? 'episodic',
      importance: options.importance ?? this.defaultImportance,
      tags: ['source:hermes', ...(options.tags ?? [])],
      agentId: options.agentId,
    });
  }

  // ------------------------------------------------------------------
  // Recall
  // ------------------------------------------------------------------

  /**
   * Recall memories relevant to the given query.
   * Automatically uses spreading activation (2 hops) for richer results.
   */
  async recall(query: string, options: HermesRecallOptions = {}): Promise<SearchResult[]> {
    return this.client.recall({
      query,
      limit: options.limit ?? 8,
      type: options.type,
      maxHops: options.maxHops ?? 2,
      agentId: options.agentId,
    });
  }

  /**
   * Recall only episodic memories (conversation history).
   */
  async recallHistory(query: string, limit = 5, agentId?: string): Promise<SearchResult[]> {
    return this.recall(query, { type: 'episodic', limit, agentId });
  }

  /**
   * Recall only semantic memories (facts & preferences).
   */
  async recallFacts(query: string, limit = 5, agentId?: string): Promise<SearchResult[]> {
    return this.recall(query, { type: 'semantic', limit, agentId });
  }

  /**
   * Recall only procedural memories (learned workflows).
   */
  async recallProcedures(query: string, limit = 5, agentId?: string): Promise<SearchResult[]> {
    return this.recall(query, { type: 'procedural', limit, agentId });
  }

  // ------------------------------------------------------------------
  // Forget
  // ------------------------------------------------------------------

  /** Hard-delete a memory by ID. */
  async forget(memoryId: string, agentId?: string): Promise<boolean> {
    return this.client.forget(memoryId, { agentId });
  }

  // ------------------------------------------------------------------
  // Associate
  // ------------------------------------------------------------------

  /** Create an explicit association between two memories. */
  async associate(
    sourceId: string,
    targetId: string,
    strength = 0.5,
    agentId?: string,
    relationType: AssociateInput['relationType'] = 'relates_to',
  ): Promise<boolean> {
    return this.client.associate(sourceId, { targetId, strength, origin: 'explicit', agentId, relationType });
  }

  // ------------------------------------------------------------------
  // Context builder (for injecting memory into LLM prompts)
  // ------------------------------------------------------------------

  /**
   * Build a formatted memory context block for injection into an LLM system prompt.
   *
   * Returns a markdown-formatted string listing the most relevant memories
   * so Hermes can surface them to the model without manual formatting.
   *
   * @example
   * const ctx = await memory.buildContext('user preferences');
   * systemPrompt = `${baseSystemPrompt}\n\n${ctx}`;
   */
  async buildContext(query: string, limit = 6, agentId?: string): Promise<string> {
    const results = await this.recall(query, { limit, agentId });
    if (results.length === 0) return '';
    
    // R5.2 Explicit "No Evidence" Signal
    if ((results as any).confidence === 'low') {
      return "I don't have information about that in my memory.";
    }

    const lines: string[] = ['## Relevant Memories', ''];
    for (const { memory, score } of results) {
      const typeLabel = memory.type.charAt(0).toUpperCase() + memory.type.slice(1);
      lines.push(`- [${typeLabel}] (relevance: ${score.toFixed(2)}) ${memory.content}`);
    }

    return lines.join('\n');
  }

  // ------------------------------------------------------------------
  // Web Page Ingestion (Phase 6)
  // ------------------------------------------------------------------


  /**
   * Ingest a web page URL and store its factual content as memories.
   *
   * The server-side pipeline automatically:
   * 1. Fetches the URL
   * 2. Converts HTML → Markdown (noise stripped)
   * 3. Chunks the content
   * 4. Extracts factual claims via LLM (using your configured provider)
   * 5. Stores facts with type/importance/metadata auto-set
   * 6. Deduplicates (won't re-ingest the same page content twice)
   *
   * Works from any gateway: Telegram, Discord, browser extension, CLI.
   *
   * @example
   * // Telegram bot handler
   * if (message.startsWith('/learn ')) {
   *   const url = message.slice(7).trim();
   *   const result = await memory.learnFromUrl(url);
   *   return `✅ Learned ${result.storedCount} facts from "${result.title}"`;
   * }
   */
  async learnFromUrl(
    url: string,
    options: {
      agentId?: string;
      confidenceThreshold?: number;
      maxChunkChars?: number;
      deduplicate?: boolean;
    } = {},
  ): Promise<{
    ok: boolean;
    title: string;
    url: string;
    storedCount: number;
    deduplicated: boolean;
    memoryIds: string[];
    error?: string;
  }> {
    const agentId = options.agentId ?? this.agentId;
    const result = await this.client.ingestUrl(url, {
      agentId,
      confidenceThreshold: options.confidenceThreshold,
      maxChunkChars: options.maxChunkChars,
      deduplicate: options.deduplicate,
    });

    return {
      ok: true,
      title: result.title,
      url: result.url,
      storedCount: result.storedCount,
      deduplicated: result.deduplicated,
      memoryIds: result.memoryIds,
    };
  }

  /**
   * Recall memories that were ingested from a specific source domain or URL pattern.
   *
   * Uses the `domain:` tag automatically added during ingestion.
   *
   * @example
   * const newsFromKompas = await memory.recallFromSource('kompas.com', 'AI regulation');
   */
  async recallFromSource(
    domain: string,
    query: string,
    limit = 8,
    agentId?: string,
  ): Promise<SearchResult[]> {
    return this.recall(query, {
      limit,
      agentId,
      tags: [`domain:${domain}`],
    });
  }
}
