import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InMemoryEventBus,
  MemoryEngine,
  SqliteDatabaseProvider,
  logger,
} from '@1mbrain/core';
import type { MemoryPassport } from '@1mbrain/core';
import type {
  BenchmarkMemoryRecord,
  BenchmarkRecallRequest,
  BenchmarkRecallResult,
  MemoryProviderAdapter,
  ProviderAvailability,
  ProviderStats,
} from '../provider.js';
import { KeywordEmbeddingProvider } from './keyword-embedding.js';
import { OpenAIEmbeddingProvider } from '@1mbrain/core';

type OneMBrainMode =
  | {
      name: '1mbrain_vector_only';
      label: '1MBrain Vector Only';
      useSpreadingActivation: false;
      maxHops: 0;
      activationThreshold: 1;
      blendWeight: 0;
    }
  | {
      name: '1mbrain_graph_light';
      label: '1MBrain Graph Light';
      useSpreadingActivation: true;
      maxHops: 1;
      activationThreshold: 0.08;
      blendWeight: 0.25;
    }
  | {
      name: '1mbrain_graph_full';
      label: '1MBrain Graph Full';
      useSpreadingActivation: true;
      maxHops: 3;
      activationThreshold: 0.05;
      blendWeight: 0.45;
    };

const MODES: Record<OneMBrainMode['name'], OneMBrainMode> = {
  '1mbrain_vector_only': {
    name: '1mbrain_vector_only',
    label: '1MBrain Vector Only',
    useSpreadingActivation: false,
    maxHops: 0,
    activationThreshold: 1,
    blendWeight: 0,
  },
  '1mbrain_graph_light': {
    name: '1mbrain_graph_light',
    label: '1MBrain Graph Light',
    useSpreadingActivation: true,
    maxHops: 1,
    activationThreshold: 0.08,
    blendWeight: 0.25,
  },
  '1mbrain_graph_full': {
    name: '1mbrain_graph_full',
    label: '1MBrain Graph Full',
    useSpreadingActivation: true,
    maxHops: 3,
    activationThreshold: 0.05,
    blendWeight: 0.45,
  },
};

export class OneMBrainBenchmarkAdapter implements MemoryProviderAdapter {
  readonly name: OneMBrainMode['name'];
  readonly label: string;
  readonly capabilities = {
    associations: true,
    forget: true,
    decay: true,
    portability: true,
  } as const;

  private readonly mode: OneMBrainMode;
  private readonly embedder = process.env['OPENAI_API_KEY']
    ? new OpenAIEmbeddingProvider(process.env['OPENAI_API_KEY'], 'text-embedding-3-small')
    : new KeywordEmbeddingProvider();
  private db: SqliteDatabaseProvider | null = null;
  private engine: MemoryEngine | null = null;
  private dbPath: string | null = null;
  private readonly idMap = new Map<string, string>();

  constructor(modeName: OneMBrainMode['name']) {
    this.mode = MODES[modeName];
    this.name = this.mode.name;
    this.label = this.mode.label;
  }

  async availability(): Promise<ProviderAvailability> {
    return { status: 'available' };
  }

  async reset(_agentId: string): Promise<void> {
    await this.close();
    logger.level = 'silent';

    this.dbPath = join(tmpdir(), `${this.name}-${process.pid}-${Date.now()}.sqlite`);
    this.db = new SqliteDatabaseProvider(this.dbPath);
    await this.db.initialize();
    this.engine = new MemoryEngine(this.db, this.embedder, new InMemoryEventBus());
    this.idMap.clear();
  }

  async remember(memory: BenchmarkMemoryRecord, agentId: string): Promise<void> {
    if (!this.engine) {
      throw new Error(`${this.name} is not initialized`);
    }

    const stored = await this.engine.remember({
      agentId,
      type: memory.type,
      content: memory.content,
      importance: memory.importance,
      tags: memory.tags,
      metadata: {
        ...(memory.metadata ?? {}),
        benchId: memory.id,
        benchTimestamp: memory.timestamp,
      },
    });

    this.idMap.set(memory.id, stored.id);
  }

  async associate(sourceId: string, targetId: string, strength: number, agentId: string): Promise<void> {
    if (!this.engine) {
      throw new Error(`${this.name} is not initialized`);
    }

    const mappedSource = this.requireMappedId(sourceId);
    const mappedTarget = this.requireMappedId(targetId);

    await this.engine.associate({
      sourceId: mappedSource,
      targetId: mappedTarget,
      agentId,
      strength,
      origin: 'explicit',
      relationType: 'relates_to',
    });
  }

  async recall(
    request: BenchmarkRecallRequest & {
      agentId: string;
    },
  ): Promise<BenchmarkRecallResult[]> {
    if (!this.engine) {
      throw new Error(`${this.name} is not initialized`);
    }

    const results = await this.engine.recall({
      agentId: request.agentId,
      query: request.query ?? '',
      limit: request.limit ?? 5,
      threshold: request.minScore ?? 0.08,
      useSpreadingActivation: this.mode.useSpreadingActivation,
      maxHops: request.maxHops ?? this.mode.maxHops,
      activationThreshold: request.activationThreshold ?? this.mode.activationThreshold,
      blendWeight: request.blendWeight ?? this.mode.blendWeight,
    });

    return results.map((result) => ({
      memoryId: String(result.memory.metadata?.['benchId'] ?? result.memory.id),
      content: result.memory.content,
      score: result.score,
      type: result.memory.type as BenchmarkMemoryRecord['type'],
      source: result.source,
      rankingTrace: result.rankingTrace,
      metadata: result.memory.metadata,
    }));
  }

  async forget(memoryId: string, agentId: string): Promise<void> {
    if (!this.engine) {
      throw new Error(`${this.name} is not initialized`);
    }

    await this.engine.forget(this.requireMappedId(memoryId), agentId);
  }

  async applyDecay(decayRate: number, minScore: number): Promise<number> {
    if (!this.db) {
      throw new Error(`${this.name} is not initialized`);
    }

    const affectedMemories = await this.db.applyDecay(decayRate, minScore);
    await this.db.applyAssociationDecay(decayRate, minScore);
    return affectedMemories;
  }

  async exportMemory(agentId: string): Promise<unknown> {
    if (!this.engine) {
      throw new Error(`${this.name} is not initialized`);
    }

    return this.engine.exportPassport(agentId);
  }

  async importMemory(payload: unknown, agentId: string): Promise<void> {
    if (!this.db) {
      throw new Error(`${this.name} is not initialized`);
    }

    const passport = payload as MemoryPassport;
    const embeddings = await this.embedder.embedBatch(passport.memories.map((memory) => memory.content));
    const oldToNewIds = new Map<string, string>();

    for (let index = 0; index < passport.memories.length; index++) {
      const memory = passport.memories[index];
      const newId = randomUUID();
      await this.db.createMemory({
        id: newId,
        agentId,
        type: memory.type,
        content: memory.content,
        embeddingModel: this.embedder.model,
        embedding: embeddings[index],
        importance: memory.importance,
        decayScore: memory.decayScore,
        tags: memory.tags,
        metadata: memory.metadata,
      });

      oldToNewIds.set(memory.id, newId);
      const benchId = String(memory.metadata?.['benchId'] ?? newId);
      this.idMap.set(benchId, newId);
    }

    for (const association of passport.associations) {
      const mappedSource = oldToNewIds.get(association.sourceId);
      const mappedTarget = oldToNewIds.get(association.targetId);
      if (!mappedSource || !mappedTarget) continue;

      await this.db.createAssociation({
        sourceId: mappedSource,
        targetId: mappedTarget,
        strength: association.strength,
        origin: association.origin,
        relationType: association.relationType ?? 'relates_to',
      });
    }
  }

  async getStats(): Promise<ProviderStats> {
    return {
      storageSizeBytes: await sqliteFootprint(this.dbPath),
    };
  }

  async close(): Promise<void> {
    if (this.engine) {
      await this.engine.shutdown();
      this.engine = null;
      this.db = null;
    }

    if (this.dbPath) {
      await removeSqliteArtifacts(this.dbPath);
      this.dbPath = null;
    }

    this.idMap.clear();
  }

  private requireMappedId(memoryId: string): string {
    const mapped = this.idMap.get(memoryId);
    if (!mapped) {
      throw new Error(`Unknown benchmark memory id ${memoryId}`);
    }
    return mapped;
  }
}

export function createOneMBrainAdapters(): MemoryProviderAdapter[] {
  return [
    new OneMBrainBenchmarkAdapter('1mbrain_vector_only'),
    new OneMBrainBenchmarkAdapter('1mbrain_graph_light'),
    new OneMBrainBenchmarkAdapter('1mbrain_graph_full'),
  ];
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
