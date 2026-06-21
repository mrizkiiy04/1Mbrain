import { describe, expect, it, vi } from 'vitest';
import { ConsolidationSummarizer } from '../src/summarizer.js';
import type { LLMClientLike, MemoryCluster } from '../src/types.js';

describe('ConsolidationSummarizer', () => {
  it('constructs a prompt and clamps importance', async () => {
    const llm: LLMClientLike = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          summary: 'User prefers concise implementation plans.',
          importance: 1.2,
          tags: ['preference'],
          keyFacts: ['Concise plans matter'],
        }),
      })),
    };
    const summarizer = new ConsolidationSummarizer(llm);

    const summary = await summarizer.summarize(cluster());

    expect(llm.chat).toHaveBeenCalledWith(expect.any(Array), true);
    expect(summary?.importance).toBe(0.95);
    expect(summary?.tags).toEqual(['work', 'preference']);
  });

  it('returns null for invalid JSON without throwing', async () => {
    const summarizer = new ConsolidationSummarizer({
      chat: async () => ({ content: 'not json' }),
    });

    await expect(summarizer.summarize(cluster())).resolves.toBeNull();
  });
});

function cluster(): MemoryCluster {
  const date = new Date('2026-05-01T00:00:00.000Z');
  return {
    id: 'cluster-1',
    agentId: 'agent-1',
    memoryIds: ['a', 'b', 'c'],
    sharedTags: ['work'],
    strategy: 'tags',
    memories: ['a', 'b', 'c'].map((id) => ({
      id,
      agentId: 'agent-1',
      type: 'episodic',
      content: `episode ${id}`,
      embeddingModel: 'mock',
      embedding: [1],
      importance: 0.3,
      decayScore: 0.1,
      createdAt: date,
      lastAccessedAt: date,
      tags: ['work'],
    })),
  };
}
