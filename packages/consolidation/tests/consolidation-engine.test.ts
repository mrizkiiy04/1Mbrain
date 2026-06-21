import { describe, expect, it, vi } from 'vitest';
import type { DatabaseProvider, EventBus, Memory, MemoryEngine } from '@1mbrain/core';
import { ConsolidationEngine } from '../src/consolidation-engine.js';
import type { MemoryCluster } from '../src/types.js';

describe('ConsolidationEngine', () => {
  it('stores a semantic summary and archives source memories', async () => {
    const db = fakeDb();
    const memoryEngine = fakeMemoryEngine();
    const eventBus = fakeEventBus();
    const engine = new ConsolidationEngine(
      memoryEngine,
      db,
      eventBus,
      fakeClusterer(),
      fakeSummarizer(),
    );

    const result = await engine.run('agent-1', { triggerReason: 'threshold' });

    expect(result.storedCount).toBe(1);
    expect(result.archivedCount).toBe(3);
    expect(result.summaryIds).toEqual(['summary-1']);
    expect(memoryEngine.remember).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'semantic',
        metadata: expect.objectContaining({ consolidatedFrom: ['a', 'b', 'c'] }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'memory:consolidated', memoryId: 'summary-1' }),
    );
  });

  it('does not write side effects during dry run', async () => {
    const memoryEngine = fakeMemoryEngine();
    const engine = new ConsolidationEngine(
      memoryEngine,
      fakeDb(),
      fakeEventBus(),
      fakeClusterer(),
      fakeSummarizer(),
    );

    const result = await engine.run('agent-1', { dryRun: true });

    expect(result.clustersProcessed).toBe(1);
    expect(result.storedCount).toBe(0);
    expect(memoryEngine.remember).not.toHaveBeenCalled();
  });

  it('isolates per-cluster summarization failures', async () => {
    const engine = new ConsolidationEngine(
      fakeMemoryEngine(),
      fakeDb(),
      fakeEventBus(),
      {
        findCandidates: async () => [],
        findClusters: async () => [cluster('a'), cluster('x')],
      },
      {
        summarize: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            summary: 'Recovered summary',
            importance: 0.8,
            tags: ['work'],
            keyFacts: [],
          }),
      },
    );

    const result = await engine.run('agent-1');

    expect(result.skipped.summarizationFailed).toBe(1);
    expect(result.storedCount).toBe(1);
  });
});

function fakeMemoryEngine(): MemoryEngine {
  return {
    remember: vi.fn(async () => ({ id: 'summary-1' })),
    forget: vi.fn(),
  } as unknown as MemoryEngine;
}

function fakeEventBus(): EventBus {
  return {
    publish: vi.fn(async () => undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  } as unknown as EventBus;
}

function fakeDb(): DatabaseProvider {
  const source = new Map(['a', 'b', 'c', 'x', 'y', 'z'].map((id) => [id, memory(id)]));
  return {
    getMemoryById: vi.fn(async (id: string) => source.get(id) ?? null),
    updateMemory: vi.fn(async (id: string) => source.get(id) ?? null),
  } as unknown as DatabaseProvider;
}

function fakeClusterer(): { findClusters: () => Promise<MemoryCluster[]> } {
  return { findClusters: async () => [cluster('a')] };
}

function fakeSummarizer() {
  return {
    summarize: vi.fn(async () => ({
      summary: 'User prefers robust implementation.',
      importance: 0.8,
      tags: ['work'],
      keyFacts: ['Robust implementation preferred'],
    })),
  };
}

function cluster(firstId: string): MemoryCluster {
  const ids = firstId === 'a' ? ['a', 'b', 'c'] : ['x', 'y', 'z'];
  return {
    id: `cluster-${firstId}`,
    agentId: 'agent-1',
    memoryIds: ids,
    memories: ids.map(memory),
    sharedTags: ['work'],
    strategy: 'tags',
  };
}

function memory(id: string): Memory {
  const date = new Date('2026-05-01T00:00:00.000Z');
  return {
    id,
    agentId: 'agent-1',
    type: 'episodic',
    content: `memory ${id}`,
    embeddingModel: 'mock',
    embedding: [1],
    importance: 0.4,
    decayScore: 0.2,
    createdAt: date,
    lastAccessedAt: date,
    tags: ['work'],
  };
}
