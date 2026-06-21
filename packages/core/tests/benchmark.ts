/**
 * Recall Accuracy & Latency Benchmark
 *
 * Compares pure vector recall against vector + spreading activation using
 * SQLite in-memory storage. Run with:
 *
 *   npm exec --workspace=packages/core tsx tests/benchmark.ts
 */

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../src/engine.js';
import { SqliteDatabaseProvider } from '../src/db/sqlite-provider.js';
import { InMemoryEventBus } from '../src/events.js';
import { logger } from '../src/logger.js';
import type { EmbeddingProvider, Memory } from '../src/types.js';

class KeywordEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'keyword-benchmark';
  readonly model = 'keyword-benchmark-v1';
  readonly dimensions = 12;

  async embed(text: string): Promise<number[]> {
    const lower = text.toLowerCase();
    const keywords = [
      'alpha',
      'beta',
      'pricing',
      'language',
      'typescript',
      'backup',
      'drive',
      'memory',
      'dashboard',
      'agent',
      'procedure',
      'preference',
    ];

    return keywords.map((keyword) => (lower.includes(keyword) ? 1 : 0));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

async function runBenchmark() {
  logger.level = 'warn';
  console.warn('--- 1MBrain Recall Benchmark ---');

  const db = new SqliteDatabaseProvider(':memory:');
  await db.initialize();
  const engine = new MemoryEngine(db, new KeywordEmbeddingProvider(), new InMemoryEventBus());

  try {
    const memories: Memory[] = [];
    for (let i = 0; i < 40; i++) {
      memories.push(
        await engine.remember({
          agentId: 'bench-agent',
          type: i % 3 === 0 ? 'episodic' : i % 3 === 1 ? 'semantic' : 'procedural',
          content: `memory item ${i} ${i % 5 === 0 ? 'alpha pricing' : 'dashboard agent'}`,
          tags: [`bucket-${i % 10}`],
        }),
      );
    }

    const seed = await engine.remember({
      agentId: 'bench-agent',
      type: 'semantic',
      content: 'alpha pricing policy',
      tags: ['target'],
    });
    const graphOnly = await engine.remember({
      agentId: 'bench-agent',
      type: 'procedural',
      content: 'procedure for renewal escalation',
      tags: ['target'],
    });

    await engine.associate({
      sourceId: seed.id,
      targetId: graphOnly.id,
      agentId: 'bench-agent',
      strength: 1,
      origin: 'explicit',
    });

    const vectorStart = performance.now();
    const vectorOnly = await engine.recall({
      agentId: 'bench-agent',
      query: 'alpha pricing',
      limit: 20,
      threshold: 0.75,
      useSpreadingActivation: false,
    });
    const vectorMs = performance.now() - vectorStart;

    const graphStart = performance.now();
    const spread = await engine.recall({
      agentId: 'bench-agent',
      query: 'alpha pricing',
      limit: 50,
      threshold: 0.75,
      useSpreadingActivation: true,
      activationThreshold: 0.1,
      blendWeight: 0.35,
    });
    const spreadMs = performance.now() - graphStart;

    console.warn(`Dataset: ${memories.length + 2} memories`);
    console.warn(`Vector-only: ${vectorOnly.length} results in ${vectorMs.toFixed(2)}ms`);
    console.warn(`Spreading activation: ${spread.length} results in ${spreadMs.toFixed(2)}ms`);
    console.warn(
      `Graph-only target surfaced: ${spread.some((result) => result.memory.id === graphOnly.id)}`,
    );
  } finally {
    await engine.shutdown();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBenchmark().catch(console.error);
}
