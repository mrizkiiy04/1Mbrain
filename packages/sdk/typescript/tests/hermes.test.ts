import { describe, it, expect, vi } from 'vitest';
import { HermesMemoryAdapter } from '../src/hermes.js';
import type { Memory, SearchResult } from '../src/index.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const NOW = new Date();

function makeMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-hermes-001',
    agentId: 'hermes',
    type: 'episodic',
    content: 'User: Hello\nHermes: Hi there!',
    importance: 0.6,
    decayScore: 1.0,
    createdAt: NOW,
    lastAccessedAt: NOW,
    tags: ['episodic', 'conversation-turn'],
    embeddingModel: 'text-embedding-3-small',
    ...overrides,
  };
}

function makeMockResult(memory: Memory): SearchResult {
  return { memory, score: 0.88 };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeAdapter() {
  const fetchMock = vi.fn();
  const adapter = new HermesMemoryAdapter({
    apiUrl: 'http://localhost:3001',
    apiKey: 'test-key',
    agentId: 'hermes',
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { adapter, fetchMock };
}

function mockFetchResponse(fetchMock: ReturnType<typeof vi.fn>, body: unknown, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    statusText: ok ? 'OK' : 'Bad Request',
    text: async () => JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// rememberTurn
// ---------------------------------------------------------------------------

describe('HermesMemoryAdapter.rememberTurn', () => {
  it('stores Q&A pair as episodic memory', async () => {
    const { adapter, fetchMock } = makeAdapter();
    const memory = makeMockMemory({ type: 'episodic' });
    mockFetchResponse(fetchMock, { success: true, data: memory });

    const result = await adapter.rememberTurn({
      userMessage: 'What is VibeAman pricing?',
      assistantReply: 'VibeAman starts at Rp 150k/month.',
    });

    expect(result.type).toBe('episodic');

    // Verify the POST body contains episodic type
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe('episodic');
    expect(body.content).toContain('What is VibeAman pricing?');
    expect(body.content).toContain('VibeAman starts at Rp 150k/month.');
    expect(body.tags).toContain('conversation-turn');
  });

  it('includes sessionId tag when provided', async () => {
    const { adapter, fetchMock } = makeAdapter();
    const memory = makeMockMemory();
    mockFetchResponse(fetchMock, { success: true, data: memory });

    await adapter.rememberTurn({
      userMessage: 'hello',
      sessionId: 'sess-xyz',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tags).toContain('session:sess-xyz');
  });

  it('formats user-only message when no assistantReply', async () => {
    const { adapter, fetchMock } = makeAdapter();
    const memory = makeMockMemory();
    mockFetchResponse(fetchMock, { success: true, data: memory });

    await adapter.rememberTurn({ userMessage: 'standalone message' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content).toBe('User: standalone message');
  });
});

// ---------------------------------------------------------------------------
// rememberPreference
// ---------------------------------------------------------------------------

describe('HermesMemoryAdapter.rememberPreference', () => {
  it('stores preference as semantic memory with high importance', async () => {
    const { adapter, fetchMock } = makeAdapter();
    const memory = makeMockMemory({ type: 'semantic', importance: 0.85 });
    mockFetchResponse(fetchMock, { success: true, data: memory });

    await adapter.rememberPreference('preferred_language', 'Bahasa Indonesia');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe('semantic');
    expect(body.importance).toBe(0.85);
    expect(body.tags).toContain('pref:preferred_language');
    expect(body.content).toContain('preferred_language');
    expect(body.content).toContain('Bahasa Indonesia');
  });
});

// ---------------------------------------------------------------------------
// rememberProcedure
// ---------------------------------------------------------------------------

describe('HermesMemoryAdapter.rememberProcedure', () => {
  it('stores procedure as procedural memory with very high importance', async () => {
    const { adapter, fetchMock } = makeAdapter();
    const memory = makeMockMemory({ type: 'procedural', importance: 0.9 });
    mockFetchResponse(fetchMock, { success: true, data: memory });

    await adapter.rememberProcedure('push_to_github', 'Create PRD → push markdown');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe('procedural');
    expect(body.importance).toBe(0.9);
    expect(body.tags).toContain('proc:push_to_github');
  });
});

// ---------------------------------------------------------------------------
// recall helpers
// ---------------------------------------------------------------------------

describe('HermesMemoryAdapter.recall', () => {
  it('defaults to 8 results and 2 hops', async () => {
    const { adapter, fetchMock } = makeAdapter();
    mockFetchResponse(fetchMock, { success: true, data: [] });

    await adapter.recall('pricing');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('limit=8');
    expect(url).toContain('maxHops=2');
  });

  it('recallHistory filters by episodic type', async () => {
    const { adapter, fetchMock } = makeAdapter();
    mockFetchResponse(fetchMock, { success: true, data: [] });

    await adapter.recallHistory('hello');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('type=episodic');
  });

  it('recallFacts filters by semantic type', async () => {
    const { adapter, fetchMock } = makeAdapter();
    mockFetchResponse(fetchMock, { success: true, data: [] });

    await adapter.recallFacts('language');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('type=semantic');
  });

  it('recallProcedures filters by procedural type', async () => {
    const { adapter, fetchMock } = makeAdapter();
    mockFetchResponse(fetchMock, { success: true, data: [] });

    await adapter.recallProcedures('push to github');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('type=procedural');
  });
});

// ---------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------

describe('HermesMemoryAdapter.buildContext', () => {
  it('returns empty string when no results', async () => {
    const { adapter, fetchMock } = makeAdapter();
    mockFetchResponse(fetchMock, { success: true, data: [] });

    const ctx = await adapter.buildContext('anything');
    expect(ctx).toBe('');
  });

  it('returns formatted markdown context block', async () => {
    const { adapter, fetchMock } = makeAdapter();
    const memory = makeMockMemory({
      type: 'semantic',
      content: 'User prefers dark mode',
    });
    mockFetchResponse(fetchMock, {
      success: true,
      data: [makeMockResult(memory)],
    });

    const ctx = await adapter.buildContext('ui preferences');
    expect(ctx).toContain('## Relevant Memories');
    expect(ctx).toContain('Semantic');
    expect(ctx).toContain('User prefers dark mode');
    expect(ctx).toContain('0.88');
  });
});
