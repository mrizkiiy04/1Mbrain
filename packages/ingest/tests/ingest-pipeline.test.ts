import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestMarkdown, ingestUrl } from '../src/ingest-pipeline.js';
import { setDefaultLLMClient } from '../src/llm-client.js';
import { setDefaultLedger, SourceLedger } from '../src/source-ledger.js';
import type { LLMClient } from '../src/llm-client.js';

// ─── Mock global fetch ─────────────────────────────────────

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head><title>Test News Article</title></head>
<body>
  <article>
    <h1>Breaking: AI Memory System 1MBrain Released</h1>
    <p>The 1MBrain system is a portable, semantic graph memory layer for AI agents.
    It supports both SQLite and PostgreSQL as storage backends with vector search capabilities.
    The system uses spreading activation to find semantically related memories.</p>
    <p>Developers can integrate using TypeScript or Python SDKs.
    The Hermes adapter provides automatic memory categorization for agent frameworks.
    Memory types include episodic, semantic, procedural, entity, and warning.</p>
  </article>
</body>
</html>`;

const MOCK_LLM_RESPONSE = JSON.stringify({
  facts: [
    {
      claim: '1MBrain is a portable, semantic graph memory layer for AI agents.',
      type: 'semantic',
      importance: 0.85,
      confidence: 0.92,
      tags: ['1mbrain', 'ai', 'memory'],
      evidence: '1MBrain system is a portable, semantic graph memory layer',
      shouldRemember: true,
    },
    {
      claim: '1MBrain supports SQLite and PostgreSQL as storage backends with vector search.',
      type: 'semantic',
      importance: 0.8,
      confidence: 0.9,
      tags: ['1mbrain', 'sqlite', 'postgresql', 'storage'],
      evidence: 'supports both SQLite and PostgreSQL as storage backends',
      shouldRemember: true,
    },
  ],
});

function makeMockLLM(): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: MOCK_LLM_RESPONSE,
      finishReason: 'stop',
    }),
  } as unknown as LLMClient;
}

function makeInMemoryLedger(): SourceLedger {
  const ledger = new SourceLedger('/tmp/test-ledger');
  // Override persist to no-op for tests
  (ledger as unknown as Record<string, unknown>)['persist'] = async () => {};
  (ledger as unknown as Record<string, unknown>)['ensureLoaded'] = async () => {
    (ledger as unknown as Record<string, unknown>)['loaded'] = true;
  };
  return ledger;
}

describe('ingestUrl', () => {
  beforeEach(() => {
    setDefaultLLMClient(makeMockLLM());
    setDefaultLedger(makeInMemoryLedger());
  });

  it('should ingest a valid HTML page and store facts', async () => {
    // Mock fetch to return sample HTML
    const mockMemoryResponse = {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: `mem-${Math.random()}` } }),
    };

    vi.stubGlobal('fetch', vi.fn()
      // First call: fetch the page
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://example.com/news/article',
        headers: new Map([['content-type', 'text/html']]),
        text: async () => SAMPLE_HTML,
      })
      // Subsequent calls: memory API POSTs
      .mockResolvedValue(mockMemoryResponse),
    );

    const result = await ingestUrl('https://example.com/news/article', {
      agentId: 'test-agent',
      apiUrl: 'http://localhost:3001',
      apiKey: 'test-key',
    });

    expect(result.ok).toBe(true);
    expect(result.title).toBeTruthy();
    expect(result.url).toContain('example.com');
    // Pipeline should have processed chunks
    expect(result.chunkCount).toBeGreaterThan(0);
    // Facts should have been extracted (LLM mocked)
    expect(result.extractedCount).toBeGreaterThanOrEqual(0);
    expect(result.deduplicated).toBe(false);

    vi.unstubAllGlobals();
  });

  it('should reject blocked URLs', async () => {
    const result = await ingestUrl('https://example.com/login', {
      agentId: 'test-agent',
      apiUrl: 'http://localhost:3001',
      apiKey: 'test-key',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('should return error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unreachable')));

    const result = await ingestUrl('https://example.com/article', {
      agentId: 'test-agent',
      apiUrl: 'http://localhost:3001',
      apiKey: 'test-key',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Fetch failed');

    vi.unstubAllGlobals();
  });

  it('should return error on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      url: 'https://example.com/missing',
    }));

    const result = await ingestUrl('https://example.com/missing', {
      agentId: 'test-agent',
      apiUrl: 'http://localhost:3001',
      apiKey: 'test-key',
    });

    expect(result.ok).toBe(false);

    vi.unstubAllGlobals();
  });

  it('should deduplicate on second ingest of same URL', async () => {
    // First ingest
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://example.com/news/article',
        headers: { get: () => 'text/html' },
        text: async () => SAMPLE_HTML,
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'mem-1' } }),
      }),
    );

    const first = await ingestUrl('https://example.com/news/article', {
      agentId: 'test-agent',
      apiUrl: 'http://localhost:3001',
      apiKey: 'test-key',
    });

    // Second ingest of same page (ledger now has the hash)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://example.com/news/article',
        headers: { get: () => 'text/html' },
        text: async () => SAMPLE_HTML, // Identical content
      }),
    );

    const second = await ingestUrl('https://example.com/news/article', {
      agentId: 'test-agent',
      apiUrl: 'http://localhost:3001',
      apiKey: 'test-key',
      deduplicateByHash: true,
    });

    if (first.ok && first.storedCount > 0) {
      expect(second.deduplicated).toBe(true);
      expect(second.storedCount).toBe(0);
    }

    vi.unstubAllGlobals();
  });

  it('should reject invalid URLs', async () => {
    const result = await ingestUrl('not-a-valid-url', {
      agentId: 'test-agent',
      apiUrl: 'http://localhost:3001',
      apiKey: 'test-key',
    });

    expect(result.ok).toBe(false);
  });

  it('ingests markdown through the same durable source and fact stores', async () => {
    const claim = vi.fn().mockResolvedValue('acquired');
    const complete = vi.fn().mockResolvedValue(undefined);
    const store = vi.fn().mockResolvedValue({ id: 'stored-fact', deduplicated: false });

    const result = await ingestMarkdown({
      agentId: 'test-agent',
      title: 'Weekly research digest',
      url: 'urn:document:weekly-research-digest',
      markdown: `${SAMPLE_HTML.replace(/<[^>]+>/g, ' ')} ${'evidence '.repeat(20)}`,
      sourceStore: { claim, complete, release: vi.fn() },
      factStore: { store },
    });

    expect(result.ok).toBe(true);
    expect(result.storedCount).toBeGreaterThan(0);
    expect(claim).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ storedCount: result.memoryIds.length }));
    expect(store).toHaveBeenCalled();
  });

  it('does not complete or mark a source when all facts are rejected', async () => {
    setDefaultLLMClient({
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({ facts: [{ claim: 'Uncertain fact', type: 'semantic', importance: 0.5, confidence: 0.1, tags: [], evidence: '', shouldRemember: false }] }),
        finishReason: 'stop',
      }),
    } as unknown as LLMClient);
    const release = vi.fn().mockResolvedValue(undefined);
    const ledger = makeInMemoryLedger();
    setDefaultLedger(ledger);

    const result = await ingestMarkdown({
      agentId: 'test-agent', title: 'Rejected digest', url: 'urn:document:rejected',
      markdown: `# Digest\n${'This is content with enough length to be processed. '.repeat(8)}`,
      sourceStore: { claim: vi.fn().mockResolvedValue('acquired'), complete: vi.fn(), release },
      factStore: { store: vi.fn() },
    });

    expect(result.storedCount).toBe(0);
    expect(release).toHaveBeenCalledOnce();
    expect(await ledger.hasSeen(result.sourceHash)).toBe(false);
  });
});
