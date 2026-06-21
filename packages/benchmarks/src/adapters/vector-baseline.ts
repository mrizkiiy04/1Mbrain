import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabaseProvider, logger } from '@1mbrain/core';
import type {
  BenchmarkMemoryRecord,
  BenchmarkRecallRequest,
  BenchmarkRecallResult,
  MemoryProviderAdapter,
  ProviderAvailability,
  ProviderStats,
} from '../provider.js';
import { KeywordEmbeddingProvider } from './keyword-embedding.js';

export class VectorBaselineAdapter implements MemoryProviderAdapter {
  readonly name = 'vector_baseline';
  readonly label = 'Vector Baseline (SQLite)';
  readonly capabilities = {
    associations: false,
    forget: true,
    decay: true,
    portability: false,
  } as const;

  private readonly embedder = new KeywordEmbeddingProvider();
  private db: SqliteDatabaseProvider | null = null;
  private dbPath: string | null = null;

  async availability(): Promise<ProviderAvailability> {
    return { status: 'available' };
  }

  async reset(_agentId: string): Promise<void> {
    await this.close();
    logger.level = 'silent';

    this.dbPath = join(tmpdir(), `${this.name}-${process.pid}-${Date.now()}.sqlite`);
    this.db = new SqliteDatabaseProvider(this.dbPath);
    await this.db.initialize();
  }

  async remember(memory: BenchmarkMemoryRecord, agentId: string): Promise<void> {
    if (!this.db) {
      throw new Error(`${this.name} is not initialized`);
    }

    await this.db.createMemory({
      id: memory.id,
      agentId,
      type: memory.type,
      content: memory.content,
      embeddingModel: this.embedder.model,
      embedding: await this.embedder.embed(memory.content),
      importance: memory.importance ?? 0.75,
      decayScore: 1,
      tags: memory.tags,
      metadata: {
        ...(memory.metadata ?? {}),
        benchId: memory.id,
        benchTimestamp: memory.timestamp,
      },
    });
  }

  async recall(
    request: BenchmarkRecallRequest & {
      agentId: string;
    },
  ): Promise<BenchmarkRecallResult[]> {
    if (!this.db) {
      throw new Error(`${this.name} is not initialized`);
    }

    const results = await this.db.searchByVector(
      request.agentId,
      await this.embedder.embed(request.query ?? ''),
      {
        limit: request.limit ?? 5,
        threshold: request.minScore ?? 0.08,
      },
    );

    return results.map((result) => ({
      memoryId: String(result.memory.metadata?.['benchId'] ?? result.memory.id),
      content: result.memory.content,
      score: result.similarity,
      type: result.memory.type as BenchmarkMemoryRecord['type'],
      source: 'vector',
      metadata: result.memory.metadata,
    }));
  }

  async forget(memoryId: string, agentId: string): Promise<void> {
    if (!this.db) {
      throw new Error(`${this.name} is not initialized`);
    }

    await this.db.deleteAssociations(memoryId);
    await this.db.deleteMemory(memoryId, agentId);
  }

  async applyDecay(decayRate: number, minScore: number): Promise<number> {
    if (!this.db) {
      throw new Error(`${this.name} is not initialized`);
    }

    return this.db.applyDecay(decayRate, minScore);
  }

  async getStats(): Promise<ProviderStats> {
    return {
      storageSizeBytes: await sqliteFootprint(this.dbPath),
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }

    if (this.dbPath) {
      await removeSqliteArtifacts(this.dbPath);
      this.dbPath = null;
    }
  }
}

async function sqliteFootprint(dbPath: string | null): Promise<number | null> {
  if (!dbPath) return null;

  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  let total = 0;
  for (const candidate of candidates) {
    try {
      total += (await stat(candidate)).size;
    } catch {
      // Ignore files that do not exist.
    }
  }
  return total;
}

async function removeSqliteArtifacts(dbPath: string): Promise<void> {
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const candidate of candidates) {
    await rm(candidate, { force: true }).catch(() => undefined);
  }
}
