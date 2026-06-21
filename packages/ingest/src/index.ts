/**
 * @1mbrain/ingest — Public API
 *
 * Web page ingestion pipeline for 1MBrain.
 *
 * Main entry point: ingestUrl()
 * Supports all gateways: Telegram, Discord, browser extension, CLI, etc.
 */

// ─── Main Pipeline ────────────────────────────────────────
export { ingestUrl } from './ingest-pipeline.js';

// ─── Types ────────────────────────────────────────────────
export type {
  IngestUrlOptions,
  IngestResult,
  ExtractedPage,
  ExtractedFact,
  MarkdownChunk,
  FactExtractionInput,
  SourceLedgerEntry,
  LLMClientConfig,
  LLMProviderType,
} from './types.js';

// ─── Building blocks (for custom pipelines) ───────────────
export { fetchPage, FetchError } from './fetcher.js';
export type { FetchResult } from './fetcher.js';

export { extractMarkdown } from './md-extractor.js';

export { cleanMarkdown } from './markdown-cleaner.js';

export { chunkMarkdown } from './chunker.js';

export { extractFactsFromChunk } from './fact-extractor.js';

export { isBlockedUrl, isBlockedClaim, isChunkWorthExtracting } from './content-filter.js';

export {
  LLMClient,
  buildLLMConfigFromEnv,
  getDefaultLLMClient,
  setDefaultLLMClient,
} from './llm-client.js';

export { SourceLedger, getDefaultLedger, setDefaultLedger } from './source-ledger.js';
