/**
 * SQLite Database Provider
 *
 * Implements the DatabaseProvider interface using better-sqlite3.
 * Vector search is done via manual cosine similarity calculation since
 * sqlite-vec availability varies. Falls back gracefully.
 *
 * Schema is created inline (no migration tool needed for SQLite).
 */

import Database from 'better-sqlite3';
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

const log = createChildLogger('sqlite-provider');

export class SqliteDatabaseProvider implements DatabaseProvider {
  private db!: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    log.info({ path: this.dbPath }, 'Initializing SQLite database');

    this.db = new Database(this.dbPath);

    // Performance pragmas
    try {
      this.db.pragma('journal_mode = WAL');
    } catch (err) {
      log.warn({ err }, 'WAL journal mode unavailable; continuing with default journaling');
    }
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB
    this.db.pragma('foreign_keys = ON');

    this.createTables();

    log.info('SQLite database initialized');
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('episodic', 'semantic', 'procedural', 'entity', 'warning')),
        content TEXT NOT NULL,
        embedding_model TEXT,
        embedding BLOB,
        importance REAL NOT NULL DEFAULT 0.5,
        decay_score REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(agent_id, type);
      CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_score);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS associations (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0.5,
        origin TEXT NOT NULL CHECK(origin IN ('co-occurrence', 'similarity', 'explicit')),
        relation_type TEXT NOT NULL DEFAULT 'relates_to',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source_id, target_id),
        FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_associations_source ON associations(source_id);
      CREATE INDEX IF NOT EXISTS idx_associations_target ON associations(target_id);

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id);
    `);

    this.createFullTextSearch();
  }

  private createFullTextSearch(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        agent_id UNINDEXED,
        type UNINDEXED,
        content,
        tags
      );

      CREATE TRIGGER IF NOT EXISTS memories_fts_after_insert
      AFTER INSERT ON memories
      BEGIN
        INSERT INTO memories_fts (id, agent_id, type, content, tags)
        VALUES (new.id, new.agent_id, new.type, new.content, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_after_delete
      AFTER DELETE ON memories
      BEGIN
        DELETE FROM memories_fts WHERE id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_after_update
      AFTER UPDATE OF agent_id, type, content, tags ON memories
      BEGIN
        DELETE FROM memories_fts WHERE id = old.id;
        INSERT INTO memories_fts (id, agent_id, type, content, tags)
        VALUES (new.id, new.agent_id, new.type, new.content, new.tags);
      END;
    `);

    this.db
      .prepare(
        `INSERT INTO memories_fts (id, agent_id, type, content, tags)
         SELECT m.id, m.agent_id, m.type, m.content, m.tags
         FROM memories m
         WHERE NOT EXISTS (
           SELECT 1 FROM memories_fts f WHERE f.id = m.id
         )`,
      )
      .run();
  }

  // ─── Memory CRUD ──────────────────────────────────────

  async createMemory(memory: Omit<Memory, 'createdAt' | 'lastAccessedAt'>): Promise<Memory> {
    const id = memory.id || uuidv4();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, agent_id, type, content, embedding_model, embedding, importance, decay_score, created_at, last_accessed_at, tags, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const embeddingBlob = memory.embedding
      ? Buffer.from(new Float64Array(memory.embedding).buffer)
      : null;

    stmt.run(
      id,
      memory.agentId,
      memory.type,
      memory.content,
      memory.embeddingModel,
      embeddingBlob,
      memory.importance,
      memory.decayScore,
      now,
      now,
      JSON.stringify(memory.tags),
      memory.metadata ? JSON.stringify(memory.metadata) : null,
    );

    log.debug({ id, agentId: memory.agentId, type: memory.type }, 'Memory created');

    return {
      ...memory,
      id,
      createdAt: new Date(now),
      lastAccessedAt: new Date(now),
    };
  }

  async getMemoryById(id: string, agentId: string): Promise<Memory | null> {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ? AND agent_id = ?')
      .get(id, agentId) as MemoryRow | undefined;

    if (!row) return null;

    // Update last_accessed_at
    this.db
      .prepare(
        "UPDATE memories SET last_accessed_at = datetime('now'), decay_score = MIN(1.0, decay_score + 0.05) WHERE id = ?",
      )
      .run(id);

    return this.rowToMemory(row);
  }

  async updateMemory(
    id: string,
    agentId: string,
    updates: Partial<Memory>,
  ): Promise<Memory | null> {
    const existing = await this.getMemoryById(id, agentId);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.importance !== undefined) {
      fields.push('importance = ?');
      values.push(updates.importance);
    }
    if (updates.decayScore !== undefined) {
      fields.push('decay_score = ?');
      values.push(updates.decayScore);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.embedding !== undefined) {
      fields.push('embedding = ?');
      fields.push('embedding_model = ?');
      values.push(
        updates.embedding ? Buffer.from(new Float64Array(updates.embedding).buffer) : null,
      );
      values.push(updates.embeddingModel ?? null);
    }

    if (fields.length === 0) return existing;

    fields.push("last_accessed_at = datetime('now')");
    values.push(id, agentId);

    this.db
      .prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ? AND agent_id = ?`)
      .run(...values);

    return this.getMemoryById(id, agentId);
  }

  async deleteMemory(id: string, agentId: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM memories WHERE id = ? AND agent_id = ?')
      .run(id, agentId);

    log.debug({ id, agentId, deleted: result.changes > 0 }, 'Memory deleted');
    return result.changes > 0;
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

    // Build WHERE clause
    let whereClause = 'agent_id = ? AND embedding IS NOT NULL';
    const params: unknown[] = [agentId];

    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE ${whereClause}`)
      .all(...params) as MemoryRow[];

    // Calculate cosine similarity in JS (portable, no extension needed)
    const results = rows
      .map((row) => {
        const storedEmbedding = this.blobToVector(row.embedding as Buffer);
        if (!storedEmbedding) return null;

        const similarity = cosineSimilarity(embedding, storedEmbedding);
        return { memory: this.rowToMemory(row), similarity };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && r.similarity >= threshold);

    // Filter by tags if specified
    const filtered = tags?.length
      ? results.filter((r) => {
          const memTags = r.memory.tags;
          return tags.some((t) => memTags.includes(t));
        })
      : results;

    // Sort by similarity descending, take top N
    filtered.sort((a, b) => b.similarity - a.similarity);

    // Update last_accessed_at for accessed memories
    const topResults = filtered.slice(0, limit);
    if (topResults.length > 0) {
      const ids = topResults.map((r) => r.memory.id);
      const placeholders = ids.map(() => '?').join(',');
      this.db
        .prepare(
          `UPDATE memories SET last_accessed_at = datetime('now'), decay_score = MIN(1.0, decay_score + 0.02) WHERE id IN (${placeholders})`,
        )
        .run(...ids);
    }

    return topResults;
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
    const matchQuery = toFtsMatchQuery(query);
    if (!matchQuery) return [];

    let whereClause = 'memories_fts MATCH ? AND m.agent_id = ?';
    const params: unknown[] = [matchQuery, agentId];

    if (type) {
      whereClause += ' AND m.type = ?';
      params.push(type);
    }

    const rows = this.db
      .prepare(
        `SELECT m.*, bm25(memories_fts) AS text_rank
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.id
         WHERE ${whereClause}
         ORDER BY text_rank ASC
         LIMIT ?`,
      )
      .all(...params, Math.max(limit * 3, limit)) as Array<MemoryRow & { text_rank: number }>;

    const filtered = tags?.length
      ? rows.filter((row) => {
          const memTags = JSON.parse(row.tags) as string[];
          return tags.some((tag) => memTags.includes(tag));
        })
      : rows;

    const topRows = filtered.slice(0, limit);
    if (topRows.length > 0) {
      const ids = topRows.map((row) => row.id);
      const placeholders = ids.map(() => '?').join(',');
      this.db
        .prepare(
          `UPDATE memories SET last_accessed_at = datetime('now'), decay_score = MIN(1.0, decay_score + 0.02) WHERE id IN (${placeholders})`,
        )
        .run(...ids);
    }

    return topRows.map((row, index) => ({
      memory: this.rowToMemory(row),
      score: 1 / (index + 1),
    }));
  }

  async createAssociation(association: Omit<Association, 'createdAt'>): Promise<Association> {
    const now = new Date().toISOString();

    // Upsert: if association exists, update strength
    this.db
      .prepare(
        `INSERT INTO associations (source_id, target_id, strength, origin, relation_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id, target_id) DO UPDATE SET
           strength = MAX(associations.strength, excluded.strength),
           origin = excluded.origin,
           relation_type = excluded.relation_type`,
      )
      .run(
        association.sourceId,
        association.targetId,
        association.strength,
        association.origin,
        association.relationType ?? 'relates_to',
        now,
      );

    log.debug(
      { sourceId: association.sourceId, targetId: association.targetId },
      'Association created/updated',
    );

    return { ...association, createdAt: new Date(now) };
  }

  async getAssociations(memoryId: string): Promise<Association[]> {
    const rows = this.db
      .prepare(`SELECT * FROM associations WHERE source_id = ? OR target_id = ?`)
      .all(memoryId, memoryId) as AssociationRow[];

    return rows.map(this.mapAssociationRow);
  }

  async deleteAssociations(memoryId: string): Promise<number> {
    const result = this.db
      .prepare('DELETE FROM associations WHERE source_id = ? OR target_id = ?')
      .run(memoryId, memoryId);

    return result.changes;
  }

  // ─── API Keys ──────────────────────────────────────────

  async getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1');
    const row = stmt.get(keyHash) as ApiKeyRow | undefined;
    if (!row) return null;
    return this.mapApiKeyRow(row);
  }

  async getApiKeysByAgent(agentId: string): Promise<ApiKeyRecord[]> {
    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE agent_id = ? ORDER BY created_at DESC');
    const rows = stmt.all(agentId) as ApiKeyRow[];
    return rows.map((r) => this.mapApiKeyRow(r));
  }

  async createApiKey(record: Omit<ApiKeyRecord, 'createdAt' | 'lastUsedAt'>): Promise<ApiKeyRecord> {
    const id = record.id || uuidv4();
    const createdAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO api_keys (id, key_hash, agent_id, name, created_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      record.keyHash,
      record.agentId,
      record.name,
      createdAt,
      record.isActive ? 1 : 0
    );

    return {
      ...record,
      id,
      createdAt: new Date(createdAt),
      lastUsedAt: null,
    };
  }

  async revokeApiKey(id: string): Promise<boolean> {
    const stmt = this.db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    const stmt = this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?');
    stmt.run(new Date().toISOString(), id);
  }

  // ─── Bulk Operations ──────────────────────────────────

  async listAgentIds(): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT DISTINCT agent_id FROM memories ORDER BY agent_id ASC')
      .all() as Array<{ agent_id: string }>;

    return rows.map((row) => row.agent_id);
  }

  async getAllMemories(agentId: string): Promise<Memory[]> {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at DESC')
      .all(agentId) as MemoryRow[];

    return rows.map(this.rowToMemory.bind(this));
  }

  async getAllAssociations(agentId: string): Promise<Association[]> {
    const rows = this.db
      .prepare(
        `SELECT a.* FROM associations a
         JOIN memories m ON a.source_id = m.id
         WHERE m.agent_id = ?`,
      )
      .all(agentId) as AssociationRow[];

    return rows.map(this.mapAssociationRow);
  }

  async bulkCreateMemories(
    memories: Array<Omit<Memory, 'createdAt' | 'lastAccessedAt'>>,
  ): Promise<Memory[]> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, agent_id, type, content, embedding_model, embedding, importance, decay_score, created_at, last_accessed_at, tags, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction(
      (items: Array<Omit<Memory, 'createdAt' | 'lastAccessedAt'>>) => {
        return items.map((m) => {
          const id = m.id || uuidv4();
          const embeddingBlob = m.embedding
            ? Buffer.from(new Float64Array(m.embedding).buffer)
            : null;

          stmt.run(
            id,
            m.agentId,
            m.type,
            m.content,
            m.embeddingModel,
            embeddingBlob,
            m.importance,
            m.decayScore,
            now,
            now,
            JSON.stringify(m.tags),
            m.metadata ? JSON.stringify(m.metadata) : null,
          );

          return {
            ...m,
            id,
            createdAt: new Date(now),
            lastAccessedAt: new Date(now),
          };
        });
      },
    );

    return insertMany(memories);
  }

  async bulkCreateAssociations(
    associations: Array<Omit<Association, 'createdAt'>>,
  ): Promise<Association[]> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO associations (source_id, target_id, strength, origin, relation_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Array<Omit<Association, 'createdAt'>>) => {
      return items.map((a) => {
        stmt.run(a.sourceId, a.targetId, a.strength, a.origin, a.relationType ?? 'relates_to', now);
        return { ...a, relationType: a.relationType ?? 'relates_to', createdAt: new Date(now) };
      });
    });

    return insertMany(associations);
  }

  // ─── Decay ────────────────────────────────────────────

  async applyDecay(decayRate: number, minScore: number): Promise<number> {
    const result = this.db
      .prepare(
        `UPDATE memories SET decay_score = MAX(?, decay_score * ?)
         WHERE decay_score > ?`,
      )
      .run(minScore, 1 - decayRate, minScore);

    log.debug({ affected: result.changes, decayRate }, 'Decay applied');
    return result.changes;
  }

  async applyAssociationDecay(decayRate: number, minStrength: number): Promise<number> {
    const result = this.db
      .prepare(
        `UPDATE associations SET strength = MAX(?, strength * ?)
         WHERE strength > ? AND origin != 'explicit'`,
      )
      .run(minStrength, 1 - decayRate, minStrength);

    log.debug({ affected: result.changes, decayRate }, 'Association decay applied');
    return result.changes;
  }

  async getGraphSize(agentId: string): Promise<{ nodes: number; edges: number }> {
    const nodes = (this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ?').get(agentId) as any).count;
    const edges = (this.db.prepare('SELECT COUNT(*) as count FROM associations WHERE source_id IN (SELECT id FROM memories WHERE agent_id = ?)').get(agentId) as any).count;
    return { nodes, edges };
  }

  async getAllNodes(agentId: string): Promise<Memory[]> {
    return this.getAllMemories(agentId);
  }

  // ─── Lifecycle ────────────────────────────────────────

  async close(): Promise<void> {
    this.db.close();
    log.info('SQLite database closed');
  }

  // ─── Private Helpers ──────────────────────────────────

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type as MemoryType,
      content: row.content,
      embeddingModel: row.embedding_model,
      embedding: this.blobToVector(row.embedding as Buffer | null),
      importance: row.importance,
      decayScore: row.decay_score,
      createdAt: new Date(row.created_at),
      lastAccessedAt: new Date(row.last_accessed_at),
      tags: JSON.parse(row.tags) as string[],
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
    };
  }

  private mapAssociationRow(row: AssociationRow): Association {
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
      isActive: row.is_active === 1,
    };
  }

  private blobToVector(blob: Buffer | null): number[] | null {
    if (!blob) return null;
    return Array.from(new Float64Array(blob.buffer, blob.byteOffset, blob.length / 8));
  }
}

// ─── Cosine Similarity ──────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ─── Row Types ──────────────────────────────────────────

function toFtsMatchQuery(query: string): string {
  const tokens = Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/'s\b/g, '')
        .match(/[a-z0-9]+(?:[.$:%/-][a-z0-9]+)*/g) ?? [],
    ),
  ).filter((token) => token.length > 1);

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

interface MemoryRow {
  id: string;
  agent_id: string;
  type: string;
  content: string;
  embedding_model: string | null;
  embedding: Buffer | null;
  importance: number;
  decay_score: number;
  created_at: string;
  last_accessed_at: string;
  tags: string;
  metadata: string | null;
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
  is_active: number;
}
