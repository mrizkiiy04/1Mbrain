import { describe, expect, it } from 'vitest';
import type { Association, DatabaseProvider, Memory } from '@1mbrain/core';
import { MemoryClusterer } from '../src/memory-clusterer.js';

const oldDate = new Date('2026-05-01T00:00:00.000Z');

describe('MemoryClusterer', () => {
  it('groups stale episodic memories by exact tag overlap', async () => {
    const db = fakeDb([
      memory('a', ['billing', 'stripe']),
      memory('b', ['stripe', 'billing']),
      memory('c', ['billing', 'stripe']),
      memory('d', ['other']),
    ]);
    const clusterer = new MemoryClusterer(db);

    const clusters = await clusterer.findClusters('agent-1', {
      clusterStrategy: 'tags',
      minAgeDays: 1,
      minClusterSize: 3,
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].memoryIds).toEqual(['a', 'b', 'c']);
    expect(clusters[0].sharedTags).toEqual(['billing', 'stripe']);
  });

  it('groups memories by graph proximity', async () => {
    const db = fakeDb(
      [memory('a', ['x']), memory('b', ['y']), memory('c', ['z']), memory('d', ['solo'])],
      [
        association('a', 'b'),
        association('b', 'c'),
      ],
    );
    const clusterer = new MemoryClusterer(db);

    const clusters = await clusterer.findClusters('agent-1', {
      clusterStrategy: 'graph',
      minAgeDays: 1,
      minClusterSize: 3,
    });

    expect(clusters).toHaveLength(1);
    expect(new Set(clusters[0].memoryIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('skips clusters smaller than the minimum size', async () => {
    const db = fakeDb([memory('a', ['x']), memory('b', ['x'])]);
    const clusterer = new MemoryClusterer(db);

    await expect(
      clusterer.findClusters('agent-1', {
        clusterStrategy: 'tags',
        minAgeDays: 1,
        minClusterSize: 3,
      }),
    ).resolves.toEqual([]);
  });

  it('returns no candidates when decay is not below cutoff', async () => {
    const db = fakeDb([memory('a', ['x'], { decayScore: 0.9 })]);
    const clusterer = new MemoryClusterer(db);

    await expect(clusterer.findCandidates('agent-1', { minAgeDays: 1 })).resolves.toEqual([]);
  });
});

function memory(id: string, tags: string[], overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    agentId: 'agent-1',
    type: 'episodic',
    content: `memory ${id}`,
    embeddingModel: 'mock',
    embedding: [1, 0],
    importance: 0.5,
    decayScore: 0.2,
    createdAt: oldDate,
    lastAccessedAt: oldDate,
    tags,
    ...overrides,
  };
}

function association(sourceId: string, targetId: string): Association {
  return {
    sourceId,
    targetId,
    strength: 0.8,
    origin: 'explicit',
    createdAt: oldDate,
  };
}

function fakeDb(memories: Memory[], associations: Association[] = []): DatabaseProvider {
  return {
    getAllMemories: async () => memories,
    getAllAssociations: async () => associations,
  } as unknown as DatabaseProvider;
}
