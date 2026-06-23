/**
 * PostgreSQL Database Provider
 *
 * Implements the DatabaseProvider interface using pg + pgvector.
 * Uses pgvector's native cosine distance operator for vector search,
 * which is significantly faster than JS-based similarity at scale.
 */

import type { Pool as PgPool, PoolClient as PgPoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type {
  DatabaseProvider,
  Memory,
  MemoryType,
  Association,
  AssociationOrigin,
  AssociationRelationType,
  ApiKeyRecord,
} from '../types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('postgres-provider');

export class PostgresDatabaseProvider implements DatabaseProvider {
  private pool!: PgPool;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async initialize(): Promise<void> {
    log.info('Initializing PostgreSQL database');

    const pgPkg = await import('pg');
    const Pool = pgPkg.default?.Pool || (pgPkg as any).Pool;

    this.pool = new Pool({
      connectionString: this.connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await this.createTables(client);
      log.info('PostgreSQL database initialized');
    } finally {
      client.release();
    }
  }

  private async createTables(client: PgPoolClient): Promise<void> {
    // Enable pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await client.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        agent_id VARCHAR(128) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK(type IN ('episodic', 'semantic', 'procedural', 'entity', 'warning')),
        content TEXT NOT NULL,
        embedding_model VARCHAR(128),
        embedding vector(1536),
        importance REAL NOT NULL DEFAULT 0.5,
        decay_score REAL NOT NULL DEFAULT 1.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tags TEXT[] NOT NULL DEFAULT '{}',
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(agent_id, type);
      CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_score);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_text_search ON memories
        USING GIN (to_tsvector('simple', content || ' ' || array_to_string(tags, ' ')));
    `);

    // Create HNSW index for vector search (if not exists)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memories_embedding'
        ) THEN
          CREATE INDEX idx_memories_embedding ON memories
          USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64);
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS associations (
        source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        strength REAL NOT NULL DEFAULT 0.5,
        origin VARCHAR(20) NOT NULL CHECK(origin IN ('co-occurrence', 'similarity', 'explicit')),
        relation_type VARCHAR(20) NOT NULL DEFAULT 'relates_to',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (source_id, target_id)
      );

      CREATE INDEX IF NOT EXISTS idx_associations_source ON associations(source_id);
      CREATE INDEX IF NOT EXISTS idx_associations_target ON associations(target_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key_hash VARCHAR(128) NOT NULL UNIQUE,
        agent_id VARCHAR(128) NOT NULL,
        name VARCHAR(256) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT true
      );

      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id);
    `);
  }

  // ─── Memory CRUD ──────────────────────────────────────

  async createMemory(memory: Omit<Memory, 'createdAt' | 'lastAccessedAt'>): Promise<Memory> {
    const id = memory.id || uuidv4();

    const embeddingStr = memory.embedding ? `[${memory.embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO memories (id, agent_id, type, content, embedding_model, embedding, importance, decay_score, tags, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        memory.agentId,
        memory.type,
        memory.content,
        memory.embeddingModel,
        embeddingStr,
        memory.importance,
        memory.decayScore,
        memory.tags,
        memory.metadata ? JSON.stringify(memory.metadata) : null,
      ],
    );

    log.debug({ id, agentId: memory.agentId, type: memory.type }, 'Memory created');
    return this.rowToMemory(result.rows[0]);
  }

  async getMemoryById(id: string, agentId: string): Promise<Memory | null> {
    const isUniversal = agentId === 'all' || agentId === '';
    const query = isUniversal
      ? `UPDATE memories SET last_accessed_at = NOW(), decay_score = LEAST(1.0, decay_score + 0.05)
         WHERE id = $1
         RETURNING *`
      : `UPDATE memories SET last_accessed_at = NOW(), decay_score = LEAST(1.0, decay_score + 0.05)
         WHERE id = $1 AND agent_id = $2
         RETURNING *`;
    const params = isUniversal ? [id] : [id, agentId];

    const result = await this.pool.query(query, params);

    if (result.rows.length === 0) return null;
    return this.rowToMemory(result.rows[0]);
  }

  async updateMemory(
    id: string,
    agentId: string,
    updates: Partial<Memory>,
  ): Promise<Memory | null> {
    const setClauses: string[] = ['last_accessed_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }
    if (updates.type !== undefined) {
      setClauses.push(`type = $${paramIndex++}`);
      values.push(updates.type);
    }
    if (updates.importance !== undefined) {
      setClauses.push(`importance = $${paramIndex++}`);
      values.push(updates.importance);
    }
    if (updates.decayScore !== undefined) {
      setClauses.push(`decay_score = $${paramIndex++}`);
      values.push(updates.decayScore);
    }
    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex++}`);
      values.push(updates.tags);
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.embedding !== undefined) {
      const embStr = updates.embedding ? `[${updates.embedding.join(',')}]` : null;
      setClauses.push(`embedding = $${paramIndex++}::vector`);
      values.push(embStr);
      setClauses.push(`embedding_model = $${paramIndex++}`);
      values.push(updates.embeddingModel ?? null);
    }

    const isUniversal = agentId === 'all' || agentId === '';
    const whereClause = isUniversal
      ? `WHERE id = $${paramIndex++}`
      : `WHERE id = $${paramIndex++} AND agent_id = $${paramIndex}`;
    
    if (isUniversal) {
      values.push(id);
    } else {
      values.push(id, agentId);
    }

    const result = await this.pool.query(
      `UPDATE memories SET ${setClauses.join(', ')}
       ${whereClause}
       RETURNING *`,
      values,
    );

    if (result.rows.length === 0) return null;
    return this.rowToMemory(result.rows[0]);
  }

  async deleteMemory(id: string, agentId: string): Promise<boolean> {
    const isUniversal = agentId === 'all' || agentId === '';
    const query = isUniversal
      ? 'DELETE FROM memories WHERE id = $1'
      : 'DELETE FROM memories WHERE id = $1 AND agent_id = $2';
    const params = isUniversal ? [id] : [id, agentId];

    const result = await this.pool.query(query, params);

    log.debug({ id, agentId, deleted: (result.rowCount ?? 0) > 0 }, 'Memory deleted');
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Vector Search ────────────────────────────────────

  async searchByVector(
    agentId: string,
    embedding: number[],
    options: {
      limit?: number;
      threshold?: number;
      type?: MemoryType;
      tags?: string[];
    } = {},
  ): Promise<Array<{ memory: Memory; similarity: number }>> {
    const { limit = 10, threshold = 0.3, type, tags } = options;

    const embeddingStr = `[${embedding.join(',')}]`;
    let paramIndex = 3;
    const conditions = ['agent_id = $1', 'embedding IS NOT NULL'];
    const params: unknown[] = [agentId, embeddingStr];

    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(type);
    }

    if (tags?.length) {
      conditions.push(`tags && $${paramIndex++}`);
      params.push(tags);
    }

    params.push(threshold, limit);

    // Use pgvector's cosine distance operator (<=>)
    // cosine_distance = 1 - cosine_similarity, so we compute similarity as 1 - distance
    const result = await this.pool.query(
      `SELECT *, 1 - (embedding <=> $2::vector) AS similarity
       FROM memories
       WHERE ${conditions.join(' AND ')}
         AND 1 - (embedding <=> $2::vector) >= $${paramIndex++}
       ORDER BY embedding <=> $2::vector ASC
       LIMIT $${paramIndex}`,
      params,
    );

    // Update last_accessed_at for returned memories
    if (result.rows.length > 0) {
      const ids = result.rows.map((r: MemoryRow) => r.id);
      await this.pool.query(
        `UPDATE memories SET last_accessed_at = NOW(), decay_score = LEAST(1.0, decay_score + 0.02)
         WHERE id = ANY($1)`,
        [ids],
      );
    }

    return result.rows.map((row: MemoryRow & { similarity: number }) => ({
      memory: this.rowToMemory(row),
      similarity: row.similarity,
    }));
  }

  // ─── Associations ─────────────────────────────────────

  async searchByText(
    agentId: string,
    query: string,
    options: {
      limit?: number;
      type?: MemoryType;
      tags?: string[];
    } = {},
  ): Promise<Array<{ memory: Memory; score: number }>> {
    const { limit = 10, type, tags } = options;
    const searchQuery = toWebSearchQuery(query);
    if (!searchQuery) return [];

    let paramIndex = 3;
    const conditions = [
      'agent_id = $1',
      "to_tsvector('simple', content || ' ' || array_to_string(tags, ' ')) @@ websearch_to_tsquery('simple', $2)",
    ];
    const params: unknown[] = [agentId, searchQuery];

    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(type);
    }

    if (tags?.length) {
      conditions.push(`tags && $${paramIndex++}`);
      params.push(tags);
    }

    params.push(limit);

    const result = await this.pool.query(
      `SELECT *,
              ts_rank_cd(
                to_tsvector('simple', content || ' ' || array_to_string(tags, ' ')),
                websearch_to_tsquery('simple', $2)
              ) AS text_rank
       FROM memories
       WHERE ${conditions.join(' AND ')}
       ORDER BY text_rank DESC, created_at DESC
       LIMIT $${paramIndex}`,
      params,
    );

    if (result.rows.length > 0) {
      const ids = result.rows.map((row: MemoryRow) => row.id);
      await this.pool.query(
        `UPDATE memories SET last_accessed_at = NOW(), decay_score = LEAST(1.0, decay_score + 0.02)
         WHERE id = ANY($1)`,
        [ids],
      );
    }

    const maxRank = Math.max(
      ...result.rows.map((row: MemoryRow & { text_rank: number | string }) =>
        Number(row.text_rank) || 0,
      ),
      0,
    );

    return result.rows.map((row: MemoryRow & { text_rank: number | string }, index: number) => ({
      memory: this.rowToMemory(row),
      score: maxRank > 0 ? (Number(row.text_rank) || 0) / maxRank : 1 / (index + 1),
    }));
  }

  async createAssociation(association: Omit<Association, 'createdAt'>): Promise<Association> {
    const result = await this.pool.query(
      `INSERT INTO associations (source_id, target_id, strength, origin, relation_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, target_id) DO UPDATE SET
         strength = GREATEST(associations.strength, EXCLUDED.strength),
         origin = EXCLUDED.origin,
         relation_type = EXCLUDED.relation_type
       RETURNING *`,
      [association.sourceId, association.targetId, association.strength, association.origin, association.relationType ?? 'relates_to'],
    );

    log.debug(
      { sourceId: association.sourceId, targetId: association.targetId },
      'Association created/updated',
    );

    return this.rowToAssociation(result.rows[0]);
  }

  async getAssociations(memoryId: string): Promise<Association[]> {
    const result = await this.pool.query(
      'SELECT * FROM associations WHERE source_id = $1 OR target_id = $1',
      [memoryId],
    );

    return result.rows.map(this.rowToAssociation);
  }

  async deleteAssociations(memoryId: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM associations WHERE source_id = $1 OR target_id = $1',
      [memoryId],
    );

    return result.rowCount ?? 0;
  }

  // ─── Bulk Operations ──────────────────────────────────

  async listAgentIds(): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT DISTINCT agent_id FROM memories ORDER BY agent_id ASC',
    );

    return result.rows.map((row: { agent_id: string }) => row.agent_id);
  }

  async getAllMemories(agentId: string): Promise<Memory[]> {
    const result = await this.pool.query(
      'SELECT * FROM memories WHERE agent_id = $1 ORDER BY created_at DESC',
      [agentId],
    );

    return result.rows.map(this.rowToMemory);
  }

  async getAllAssociations(agentId: string): Promise<Association[]> {
    const result = await this.pool.query(
      `SELECT a.* FROM associations a
       JOIN memories m ON a.source_id = m.id
       WHERE m.agent_id = $1`,
      [agentId],
    );

    return result.rows.map(this.rowToAssociation);
  }

  async bulkCreateMemories(
    memories: Array<Omit<Memory, 'createdAt' | 'lastAccessedAt'>>,
  ): Promise<Memory[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const results: Memory[] = [];
      for (const m of memories) {
        const embStr = m.embedding ? `[${m.embedding.join(',')}]` : null;

        const result = await client.query(
          `INSERT INTO memories (id, agent_id, type, content, embedding_model, embedding, importance, decay_score, tags, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10)
           RETURNING *`,
          [
            m.id || uuidv4(),
            m.agentId,
            m.type,
            m.content,
            m.embeddingModel,
            embStr,
            m.importance,
            m.decayScore,
            m.tags,
            m.metadata ? JSON.stringify(m.metadata) : null,
          ],
        );
        results.push(this.rowToMemory(result.rows[0]));
      }

      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async bulkCreateAssociations(
    associations: Array<Omit<Association, 'createdAt'>>,
  ): Promise<Association[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const results: Association[] = [];
      for (const a of associations) {
        const result = await client.query(
          `INSERT INTO associations (source_id, target_id, strength, origin, relation_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_id, target_id) DO UPDATE SET
             strength = GREATEST(associations.strength, EXCLUDED.strength)
           RETURNING *`,
          [a.sourceId, a.targetId, a.strength, a.origin, a.relationType ?? 'relates_to'],
        );
        results.push(this.rowToAssociation(result.rows[0]));
      }

      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Decay ────────────────────────────────────────────

  async applyDecay(decayRate: number, minScore: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE memories SET decay_score = GREATEST($1, decay_score * $2)
       WHERE decay_score > $1`,
      [minScore, 1 - decayRate],
    );

    log.debug({ affected: result.rowCount, decayRate }, 'Decay applied');
    return result.rowCount ?? 0;
  }

  async applyAssociationDecay(decayRate: number, minStrength: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE associations SET strength = GREATEST($1, strength * $2)
       WHERE strength > $1 AND origin != 'explicit'`,
      [minStrength, 1 - decayRate],
    );

    log.debug({ affected: result.rowCount, decayRate }, 'Association decay applied');
    return result.rowCount ?? 0;
  }

  async getGraphSize(agentId: string): Promise<{ nodes: number; edges: number }> {
    const nodesRes = await this.pool.query('SELECT COUNT(*) as count FROM memories WHERE agent_id = $1', [agentId]);
    const edgesRes = await this.pool.query('SELECT COUNT(*) as count FROM associations WHERE source_id IN (SELECT id FROM memories WHERE agent_id = $1)', [agentId]);
    return { 
      nodes: parseInt(nodesRes.rows[0].count, 10), 
      edges: parseInt(edgesRes.rows[0].count, 10) 
    };
  }

  async getAllNodes(agentId: string): Promise<Memory[]> {
    return this.getAllMemories(agentId);
  }

  // ─── API Keys ──────────────────────────────────────────

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const res = await this.pool.query('SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true', [keyHash]);
    if (res.rows.length === 0) return null;
    return this.mapApiKeyRow(res.rows[0]);
  }

  async getApiKeysByAgent(agentId: string): Promise<ApiKeyRecord[]> {
    const res = await this.pool.query('SELECT * FROM api_keys WHERE agent_id = $1 ORDER BY created_at DESC', [agentId]);
    return res.rows.map((r) => this.mapApiKeyRow(r));
  }

  async createApiKey(record: Omit<ApiKeyRecord, 'createdAt' | 'lastUsedAt'>): Promise<ApiKeyRecord> {
    const id = record.id || uuidv4();
    const createdAt = new Date();

    await this.pool.query(
      `INSERT INTO api_keys (id, key_hash, agent_id, name, created_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        record.keyHash,
        record.agentId,
        record.name,
        createdAt,
        record.isActive,
      ]
    );

    return {
      ...record,
      id,
      createdAt,
      lastUsedAt: null,
    };
  }

  async revokeApiKey(id: string): Promise<boolean> {
    const res = await this.pool.query('UPDATE api_keys SET is_active = false WHERE id = $1', [id]);
    return (res.rowCount || 0) > 0;
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await this.pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [id]);
  }

  // ─── Lifecycle ────────────────────────────────────────

  async close(): Promise<void> {
    await this.pool.end();
    log.info('PostgreSQL pool closed');
  }

  // ─── Private Helpers ──────────────────────────────────

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type as MemoryType,
      content: row.content,
      embeddingModel: row.embedding_model,
      embedding: row.embedding ? parseVector(row.embedding) : null,
      importance: row.importance,
      decayScore: row.decay_score,
      createdAt: new Date(row.created_at),
      lastAccessedAt: new Date(row.last_accessed_at),
      tags: row.tags ?? [],
      metadata: row.metadata ?? undefined,
    };
  }

  private rowToAssociation(row: AssociationRow): Association {
    return {
      sourceId: row.source_id,
      targetId: row.target_id,
      strength: row.strength,
      origin: row.origin as AssociationOrigin,
      relationType: (row.relation_type ?? 'relates_to') as AssociationRelationType,
      createdAt: new Date(row.created_at),
    };
  }

  private mapApiKeyRow(row: ApiKeyRow): ApiKeyRecord {
    return {
      id: row.id,
      keyHash: row.key_hash,
      agentId: row.agent_id,
      name: row.name,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      isActive: row.is_active,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────

function parseVector(value: string | number[]): number[] {
  if (Array.isArray(value)) return value;
  // pgvector returns strings like "[0.1,0.2,0.3]"
  return JSON.parse(value) as number[];
}


function toWebSearchQuery(query: string): string {
  const tokens = Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/'s\b/g, '')
        .match(/[a-z0-9]+(?:[.$:%/-][a-z0-9]+)*/g) ?? [],
    ),
  ).filter((token) => token.length > 1);

  return tokens.join(' OR ');
}

interface MemoryRow {
  id: string;
  agent_id: string;
  type: string;
  content: string;
  embedding_model: string | null;
  embedding: string | null;
  importance: number;
  decay_score: number;
  created_at: string;
  last_accessed_at: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
}

interface AssociationRow {
  source_id: string;
  target_id: string;
  strength: number;
  origin: string;
  relation_type: string;
  created_at: string;
}

interface ApiKeyRow {
  id: string;
  key_hash: string;
  agent_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  is_active: boolean;
}
