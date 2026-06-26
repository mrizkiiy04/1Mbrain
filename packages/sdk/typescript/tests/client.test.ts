import { describe, expect, it, vi } from 'vitest';
import { OneMBrainClient } from '../src/index.js';
import type { OneMBrainError } from '../src/index.js';

const memory = {
  id: 'mem-1',
  agentId: 'agent-1',
  type: 'semantic',
  content: 'User prefers TypeScript',
  embeddingModel: 'test',
  embedding: [1, 0],
  importance: 0.5,
  decayScore: 1,
  createdAt: '2026-06-17T09:00:00.000Z',
  lastAccessedAt: '2026-06-17T09:00:00.000Z',
  tags: ['preference'],
};

describe('OneMBrainClient', () => {
  it('sends remember requests with API key and agent headers', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: memory,
      }),
    );
    const client = new OneMBrainClient({
      apiUrl: 'http://localhost:3100/',
      apiKey: 'secret',
      agentId: 'agent-1',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const created = await client.remember({
      type: 'semantic',
      content: 'User prefers TypeScript',
      tags: ['preference'],
    });

    expect(created.createdAt).toBeInstanceOf(Date);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/v1/memories',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'secret',
          'x-agent-id': 'agent-1',
        }),
      }),
    );
  });

  it('builds recall query parameters for spreading activation options', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [{ memory, score: 0.9, source: 'combined' }],
      }),
    );
    const client = new OneMBrainClient({
      apiUrl: 'http://localhost:3100',
      apiKey: 'secret',
      agentId: 'agent-1',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const results = await client.recall({
      query: 'typescript',
      tags: ['preference', 'language'],
      limit: 5,
      useSpreadingActivation: false,
      activationThreshold: 0.2,
      blendWeight: 0.4,
    });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/v1/memories/search');
    expect(url.searchParams.get('q')).toBe('typescript');
    expect(url.searchParams.get('tags')).toBe('preference,language');
    expect(url.searchParams.get('useSpreadingActivation')).toBe('false');
    expect(url.searchParams.get('activationThreshold')).toBe('0.2');
    expect(url.searchParams.get('blendWeight')).toBe('0.4');
    expect(results[0].memory.lastAccessedAt).toBeInstanceOf(Date);
  });

  it('supports forget and associate helpers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    const client = new OneMBrainClient({
      apiUrl: 'http://localhost:3100',
      apiKey: 'secret',
      agentId: 'agent-1',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.forget('mem-1')).resolves.toBe(true);
    await expect(
      client.associate('mem-1', { targetId: 'mem-2', strength: 0.8, relationType: 'supersedes' }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3100/v1/memories/mem-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3100/v1/memories/mem-1/associate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"relationType":"supersedes"'),
      }),
    );
  });

  it('supports consolidation helper', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          agentId: 'agent-1',
          triggerReason: 'threshold',
          dryRun: true,
          storedCount: 0,
          archivedCount: 0,
          clustersProcessed: 1,
          skipped: {
            noCandidates: 0,
            tooSmallClusters: 0,
            summarizationFailed: 0,
            dryRun: 3,
          },
          errors: [],
          summaryIds: [],
        },
      }),
    );
    const client = new OneMBrainClient({
      apiUrl: 'http://localhost:3100',
      apiKey: 'secret',
      agentId: 'agent-1',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await client.consolidate({ dryRun: true, clusterStrategy: 'tags' });

    expect(result.dryRun).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/v1/consolidate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"clusterStrategy":"tags"'),
      }),
    );
  });

  it('posts trusted Markdown to the ingestion endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { title: 'Digest', url: 'urn:document:digest', sourceHash: 'a'.repeat(64), chunkCount: 1, extractedCount: 1, storedCount: 1, skippedCount: 0, errorCount: 0, deduplicated: false, memoryIds: ['mem-1'] } }),
    );
    const client = new OneMBrainClient({ apiUrl: 'http://localhost:3100', apiKey: 'secret', agentId: 'agent-1', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.ingestMarkdown({ title: 'Digest', url: 'urn:document:digest', markdown: '# Digest\nA useful fact.' })).resolves.toMatchObject({ storedCount: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/v1/ingest/markdown',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"markdown":"# Digest') }),
    );
  });

  it('throws typed errors for non-2xx responses', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Invalid API key' }, 403));
    const client = new OneMBrainClient({
      apiUrl: 'http://localhost:3100',
      apiKey: 'bad',
      agentId: 'agent-1',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.forget('mem-1')).rejects.toMatchObject<Partial<OneMBrainError>>({
      name: 'OneMBrainError',
      status: 403,
      message: 'Invalid API key',
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
