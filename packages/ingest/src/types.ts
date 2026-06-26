/**
 * Ingest Pipeline Types
 *
 * Central type definitions for the MD page ingestion system.
 * Every stage of the pipeline works with these shared types.
 */

import type { MemoryType } from '@1mbrain/core';

// ─── Raw Extraction ───────────────────────────────────────

export interface ExtractedPage {
  /** Clean title extracted from <title> or <h1> */
  title: string;
  /** Final URL after redirects */
  url: string;
  /** Main content converted to Markdown (noise stripped) */
  markdown: string;
  /** Plain text version for hashing */
  textContent: string;
  /** ISO timestamp when captured */
  capturedAt: string;
  /** SHA-256 hash of url + textContent for deduplication */
  sourceHash: string;
}

// ─── Chunking ─────────────────────────────────────────────

export interface MarkdownChunk {
  /** Zero-based chunk index within the page */
  index: number;
  /** Cleaned markdown content (max ~1800 chars) */
  content: string;
}

// ─── Fact Extraction ─────────────────────────────────────

export interface ExtractedFact {
  /** The factual claim in concise form */
  claim: string;
  /** Memory type for this fact */
  type: MemoryType;
  /** Importance score 0-1 (ingest pipeline sets this) */
  importance: number;
  /** LLM confidence that this is a valid factual claim (0-1) */
  confidence: number;
  /** Tags to attach to the memory */
  tags: string[];
  /** The raw text from the chunk that supports this claim */
  evidence: string;
  /** Whether the pipeline should store this fact */
  shouldRemember: boolean;
}

export interface FactExtractionInput {
  title: string;
  url: string;
  chunkIndex: number;
  markdown: string;
}

// ─── Source Ledger ────────────────────────────────────────

export interface SourceLedgerEntry {
  sourceHash: string;
  url: string;
  title: string;
  storedAt: string;
  factCount: number;
}

// ─── Ingest Pipeline ──────────────────────────────────────

export interface IngestSourceStore {
  claim(input: { agentId: string; sourceHash: string; url: string; title: string }): Promise<'acquired' | 'completed' | 'in_progress'>;
  complete(input: { agentId: string; sourceHash: string; storedCount: number }): Promise<void>;
  release(input: { agentId: string; sourceHash: string }): Promise<void>;
}

export interface IngestFactStoreInput {
  id: string;
  agentId: string;
  type: MemoryType;
  content: string;
  importance: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface IngestFactStoreResult {
  id: string;
  deduplicated: boolean;
}

export interface IngestFactStore {
  store(input: IngestFactStoreInput): Promise<IngestFactStoreResult>;
}

export interface IngestUrlOptions {
  /** Agent ID that will own the ingested memories */
  agentId: string;
  /** API base URL of the 1MBrain server */
  apiUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /**
   * Minimum LLM confidence to store a fact (default: 0.75).
   * Facts below this threshold are silently skipped.
   */
  confidenceThreshold?: number;
  /**
   * Maximum chunk size in characters (default: 1800).
   * Smaller = more granular facts. Larger = more context.
   */
  maxChunkChars?: number;
  /**
   * If true, skip URL if it has already been ingested (default: true).
   * Deduplication is based on sourceHash = SHA-256(url + textContent).
   */
  deduplicateByHash?: boolean;
  /**
   * Request timeout for fetching the page in milliseconds (default: 15000).
   */
  fetchTimeoutMs?: number;
  /** Optional server-side persistence boundary. When supplied, avoids self-HTTP storage calls. */
  sourceStore?: IngestSourceStore;
  factStore?: IngestFactStore;
  /** Internal normalized-content input used by ingestMarkdown(). */
  markdownInput?: { title: string; markdown: string };
}

export interface IngestMarkdownOptions extends IngestUrlOptions {
  title: string;
  /** Stable URL or URN that identifies the input document. */
  url: string;
  markdown: string;
}

export interface IngestResult {
  ok: boolean;
  title: string;
  url: string;
  sourceHash: string;
  /** Number of Markdown chunks the page was split into */
  chunkCount: number;
  /** Number of facts extracted by LLM */
  extractedCount: number;
  /** Number of facts that passed confidence filter and were stored */
  storedCount: number;
  /** Number of facts skipped (low confidence or blocked content) */
  skippedCount: number;
  /** Number of facts that failed to store */
  errorCount: number;
  /** Whether this URL was skipped due to deduplication */
  deduplicated?: boolean;
  /** IDs of memories stored or idempotently reused in this run */
  memoryIds: string[];
  /** Facts already persisted by a prior attempt and safely reused. */
  deduplicatedFactCount?: number;
  /** Human-readable error message if ok=false */
  error?: string;
}

// ─── LLM Client ───────────────────────────────────────────

export type LLMProviderType = 'openai' | 'ollama';

export interface LLMClientConfig {
  provider: LLMProviderType;
  /** Chat model name (e.g. "gpt-4o-mini" or "llama3.2") */
  model: string;
  /** API key — required for OpenAI, ignored for Ollama */
  apiKey?: string;
  /** Base URL — e.g. "https://api.openai.com" or "http://localhost:11434" */
  baseUrl: string;
  /** Request timeout ms (default: 30000) */
  timeoutMs?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatResult {
  content: string;
  finishReason: string;
}
