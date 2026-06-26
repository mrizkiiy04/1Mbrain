/**
 * Ingest Pipeline — Main Orchestrator
 *
 * Coordinates all pipeline stages:
 * 1. Content filter (URL check)
 * 2. Fetch HTML
 * 3. Extract Markdown (Readability + Turndown)
 * 4. Clean Markdown
 * 5. Deduplication check (source ledger)
 * 6. Chunk
 * 7. For each chunk: content filter → LLM fact extraction → confidence filter → POST to memory API
 * 8. Mark URL as seen in ledger
 *
 * Gateway-agnostic: works from Telegram bot, Discord bot, browser extension, or CLI.
 * The memory API URL and agent ID are passed in options — not hardcoded.
 */

import { fetchPage } from './fetcher.js';
import { extractMarkdown, extractMarkdownContent } from './md-extractor.js';
import { cleanMarkdown } from './markdown-cleaner.js';
import { chunkMarkdown } from './chunker.js';
import { extractFactsFromChunk } from './fact-extractor.js';
import { isBlockedUrl, isBlockedClaim, isChunkWorthExtracting } from './content-filter.js';
import { getDefaultLLMClient } from './llm-client.js';
import { getDefaultLedger } from './source-ledger.js';
import type { IngestUrlOptions, IngestMarkdownOptions, IngestResult } from './types.js';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_MAX_CHUNK_CHARS = 1800;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_DEDUPLICATE = true;

/**
 * Ingest a web page URL into 1MBrain memory.
 *
 * Complete pipeline: fetch → markdown → clean → chunk → extract facts → store.
 * Returns an IngestResult describing what was stored.
 *
 * @example
 * ```ts
 * const result = await ingestUrl('https://example.com/news/article', {
 *   agentId: 'telegram-bot-news',
 *   apiUrl: 'http://localhost:3001',
 *   apiKey: 'my-api-key',
 * });
 * console.log(`Stored ${result.storedCount} facts from ${result.title}`);
 * ```
 */
export async function ingestUrl(
  url: string,
  options: IngestUrlOptions,
): Promise<IngestResult> {
  const {
    agentId,
    apiUrl,
    apiKey,
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
    maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
    deduplicateByHash = DEFAULT_DEDUPLICATE,
    fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    sourceStore,
    factStore,
  } = options;

  const llm = getDefaultLLMClient();
  const ledger = getDefaultLedger();

  // ── Step 1: URL filter ──────────────────────────────────

  if (!options.markdownInput) {
    const urlCheck = isBlockedUrl(url);
    if (urlCheck.blocked) return fail(url, `URL blocked: ${urlCheck.reason}`);
  }

  // ── Step 2: Fetch HTML ──────────────────────────────────

  let finalUrl = url;
  let page;
  if (options.markdownInput) {
    try {
      page = await extractMarkdownContent(options.markdownInput.markdown, url, options.markdownInput.title);
    } catch (err) {
      return fail(url, `Markdown preparation failed: ${(err as Error).message}`);
    }
  } else {
    let html: string;
    try {
      const fetchResult = await fetchPage(url, fetchTimeoutMs);
      html = fetchResult.html;
      finalUrl = fetchResult.finalUrl;
    } catch (err) {
      return fail(url, `Fetch failed: ${(err as Error).message}`);
    }
    try {
      page = await extractMarkdown(html, finalUrl);
    } catch (err) {
      return fail(url, `Markdown extraction failed: ${(err as Error).message}`);
    }
  }

  // ── Step 4: Deduplication ───────────────────────────────

  if (deduplicateByHash) {
    const alreadySeen = await ledger.hasSeen(page.sourceHash);
    if (alreadySeen) {
      return {
        ok: true,
        title: page.title,
        url: finalUrl,
        sourceHash: page.sourceHash,
        chunkCount: 0,
        extractedCount: 0,
        storedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        deduplicated: true,
        memoryIds: [],
      };
    }
  }

  let sourceClaimed = false;
  if (sourceStore) {
    const claim = await sourceStore.claim({
      agentId,
      sourceHash: page.sourceHash,
      url: finalUrl,
      title: page.title,
    });
    if (claim === 'completed') {
      return {
        ok: true, title: page.title, url: finalUrl, sourceHash: page.sourceHash,
        chunkCount: 0, extractedCount: 0, storedCount: 0, skippedCount: 0,
        errorCount: 0, deduplicated: true, memoryIds: [],
      };
    }
    if (claim === 'in_progress') {
      return fail(finalUrl, 'This source is already being ingested. Retry after the active ingest finishes.');
    }
    sourceClaimed = true;
  }

  // ── Step 5: Clean ───────────────────────────────────────

  const cleanedMarkdown = cleanMarkdown(page.markdown);

  if (cleanedMarkdown.trim().length < 100) {
    return fail(finalUrl, 'Page content too short after cleaning — likely an empty or login page');
  }

  // ── Step 6: Chunk ───────────────────────────────────────

  const chunks = chunkMarkdown(cleanedMarkdown, maxChunkChars);

  if (chunks.length === 0) {
    return fail(finalUrl, 'No meaningful chunks extracted from page');
  }

  // ── Step 7: Extract facts + store ──────────────────────

  let extractedCount = 0;
  let storedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const memoryIds: string[] = [];
  let deduplicatedFactCount = 0;

  for (const chunk of chunks) {
    // Skip low-value chunks before hitting LLM
    if (!isChunkWorthExtracting(chunk.content)) {
      skippedCount++;
      continue;
    }

    let facts;
    try {
      facts = await extractFactsFromChunk(
        {
          title: page.title,
          url: finalUrl,
          chunkIndex: chunk.index,
          markdown: chunk.content,
        },
        llm,
      );
    } catch {
      // LLM failed for this chunk — continue with others
      errorCount++;
      continue;
    }

    extractedCount += facts.length;

    for (const fact of facts) {
      // Confidence gate
      if (!fact.shouldRemember || fact.confidence < confidenceThreshold) {
        skippedCount++;
        continue;
      }

      // Content filter on the claim itself
      const claimCheck = isBlockedClaim(fact.claim);
      if (claimCheck.blocked) {
        skippedCount++;
        continue;
      }

      const metadata = {
        sourceTitle: page.title,
        sourceUrl: finalUrl,
        sourceDomain: new URL(finalUrl).hostname,
        sourceHash: page.sourceHash,
        capturedAt: page.capturedAt,
        chunkIndex: chunk.index,
        evidence: fact.evidence,
        confidence: fact.confidence,
        ingestionMode: 'markdown-page',
        extractorVersion: '1.1.0',
      };
      const tags = [
        ...fact.tags,
        'source:web-page',
        `domain:${new URL(finalUrl).hostname}`,
        `ingest:${new Date().toISOString().slice(0, 10)}`,
      ];

      if (factStore) {
        try {
          const stored = await factStore.store({
            id: await deterministicMemoryId(agentId, page.sourceHash, chunk.index, fact.claim),
            agentId,
            type: fact.type,
            content: fact.claim,
            importance: fact.importance,
            tags,
            metadata,
          });
          memoryIds.push(stored.id);
          if (stored.deduplicated) deduplicatedFactCount++;
          else storedCount++;
        } catch {
          errorCount++;
        }
        continue;
      }

      // POST to a remote 1MBrain memory API when no server-side fact store is available.
      if (!apiUrl || !apiKey) {
        errorCount++;
        continue;
      }
      try {
        const res = await fetch(`${apiUrl}/v1/memories`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
            'X-Agent-Id': agentId,
          },
          body: JSON.stringify({
            content: fact.claim,
            type: fact.type,
            importance: fact.importance,
            tags,
            metadata,
          }),
        });

        if (!res.ok) {
          errorCount++;
          continue;
        }

        const body = (await res.json()) as { data?: { id?: string } };
        const memId = body.data?.id;
        if (memId) memoryIds.push(memId);
        storedCount++;
      } catch {
        errorCount++;
      }
    }
  }

  // ── Step 8: Mark as seen ────────────────────────────────

  const completed = errorCount === 0 && (storedCount > 0 || deduplicatedFactCount > 0);
  if (sourceStore && sourceClaimed) {
    if (completed) {
      await sourceStore.complete({
        agentId,
        sourceHash: page.sourceHash,
        storedCount: memoryIds.length,
      });
    } else {
      await sourceStore.release({ agentId, sourceHash: page.sourceHash });
    }
  }

  // A zero-store attempt is intentionally retryable: do not poison the local ledger.
  if (completed) {
    await ledger.markSeen(page.sourceHash, {
      url: finalUrl,
      title: page.title,
      factCount: memoryIds.length,
    });
  }

  return {
    ok: true,
    title: page.title,
    url: finalUrl,
    sourceHash: page.sourceHash,
    chunkCount: chunks.length,
    extractedCount,
    storedCount,
    skippedCount,
    errorCount,
    deduplicated: false,
    memoryIds,
    deduplicatedFactCount,
  };
}

export async function ingestMarkdown(options: IngestMarkdownOptions): Promise<IngestResult> {
  return ingestUrl(options.url, { ...options, markdownInput: { title: options.title, markdown: options.markdown } });
}

async function deterministicMemoryId(
  agentId: string,
  sourceHash: string,
  chunkIndex: number,
  claim: string,
): Promise<string> {
  const { createHash } = await import('crypto');
  const hash = createHash('sha256')
    .update(`${agentId}\u0000${sourceHash}\u0000${chunkIndex}\u0000${claim.trim().toLowerCase()}`, 'utf8')
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// ─── Helpers ─────────────────────────────────────────────

function fail(url: string, error: string): IngestResult {
  return {
    ok: false,
    title: '',
    url,
    sourceHash: '',
    chunkCount: 0,
    extractedCount: 0,
    storedCount: 0,
    skippedCount: 0,
    errorCount: 1,
    memoryIds: [],
    error,
  };
}
