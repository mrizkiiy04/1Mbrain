/**
 * 1MBrain Core Types
 *
 * Central type definitions for the memory engine.
 * These types are the contract between all layers of the system.
 */

// ─── Memory Types ────────────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'entity' | 'warning';

export type AssociationOrigin = 'co-occurrence' | 'similarity' | 'explicit';

export type AssociationRelationType = 'relates_to' | 'supersedes' | 'derived_from';

export interface Memory {
  id: string;
  agentId: string;
  type: MemoryType;
  content: string;
  embeddingModel: string | null;
  embedding: number[] | null;
  importance: number;
  decayScore: number;
  createdAt: Date;
  lastAccessedAt: Date;
  tags: string[];
  /** Optional structured metadata — e.g. sourceUrl, confidence, evidence from ingest pipeline. */
  metadata?: Record<string, unknown>;
}

export interface Association {
  sourceId: string;
  targetId: string;
  strength: number;
  origin: AssociationOrigin;
  /** Semantic meaning of the relationship. Defaults to 'relates_to'. */
  relationType: AssociationRelationType;
  createdAt: Date;
}

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  agentId: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
}

// ─── API Request/Response Types ─────────────────────────

export interface CreateMemoryInput {
  agentId: string;
  type: MemoryType;
  content: string;
  importance?: number;
  tags?: string[];
  /** Optional structured metadata stored alongside the memory (e.g. sourceUrl, evidence, confidence). */
  metadata?: Record<string, unknown>;
  associations?: Array<{
    targetId: string;
    strength?: number;
    relationType?: AssociationRelationType;
  }>;
}

export interface SearchMemoryInput {
  agentId: string;
  query: string;
  type?: MemoryType;
  tags?: string[];
  limit?: number;
  threshold?: number;
  useSpreadingActivation?: boolean;
  maxHops?: number;
  activationThreshold?: number;
  blendWeight?: number;
  crossAgent?: boolean;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  source: 'vector' | 'association' | 'combined' | 'lexical';
  rankingTrace?: string[];
}

export interface CreateAssociationInput {
  sourceId: string;
  targetId: string;
  agentId?: string;
  strength?: number;
  origin?: AssociationOrigin;
  relationType?: AssociationRelationType;
}

// ─── Memory Passport Types ──────────────────────────────

export interface MemoryPassport {
  version: string;
  exportedAt: Date;
  sourceAgent: string;
  embeddingModel: string;
  memories: Memory[];
  associations: Association[];
  metadata: {
    totalMemories: number;
    totalAssociations: number;
    memoryTypes: Record<MemoryType, number>;
  };
}

export interface MemoryPassportEnvelope {
  format: '1mbrain.passport.envelope';
  version: string;
  exportedAt: string;
  sourceAgent: string;
  compression: 'gzip';
  encoding: 'base64';
  encryption: {
    algorithm: 'aes-256-gcm';
    iv: string;
    authTag: string;
  };
  payload: string;
}

// ─── Embedding Provider Interface ───────────────────────

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ─── Event Types (for WebSocket/Pub-Sub) ────────────────

export type MemoryEventType =
  | 'memory:created'
  | 'memory:accessed'
  | 'memory:updated'
  | 'memory:deleted'
  | 'memory:consolidated'
  | 'association:created'
  | 'association:deleted';

export interface MemoryEvent {
  type: MemoryEventType;
  memoryId: string;
  agentId: string;
  memoryType?: MemoryType;
  timestamp: Date;
  data?: Record<string, unknown>;
}

// ─── Database Provider Interface ────────────────────────

export interface DatabaseProvider {
  // Memory CRUD
  createMemory(memory: Omit<Memory, 'createdAt' | 'lastAccessedAt'>): Promise<Memory>;
  getMemoryById(id: string, agentId?: string): Promise<Memory | null>;
  updateMemory(id: string, agentId: string, updates: Partial<Memory>): Promise<Memory | null>;
  deleteMemory(id: string, agentId: string): Promise<boolean>;

  // Vector search
  searchByVector(
    agentId: string,
    embedding: number[],
    options: {
      limit?: number;
      threshold?: number;
      type?: MemoryType;
      tags?: string[];
      crossAgent?: boolean;
    },
  ): Promise<Array<{ memory: Memory; similarity: number }>>;

  // Native text search
  searchByText(
    agentId: string,
    query: string,
    options: {
      limit?: number;
      type?: MemoryType;
      tags?: string[];
      crossAgent?: boolean;
    },
  ): Promise<Array<{ memory: Memory; score: number }>>;

  // Associations
  createAssociation(association: Omit<Association, 'createdAt'>): Promise<Association>;
  getAssociations(memoryId: string): Promise<Association[]>;
  deleteAssociations(memoryId: string): Promise<number>;

  // Bulk operations
  listAgentIds(): Promise<string[]>;
  getAllMemories(agentId: string): Promise<Memory[]>;
  getAllAssociations(agentId: string): Promise<Association[]>;
  getGraphSize(agentId: string): Promise<{ nodes: number; edges: number }>;
  getAllNodes(agentId: string): Promise<Memory[]>;
  bulkCreateMemories(
    memories: Array<Omit<Memory, 'createdAt' | 'lastAccessedAt'>>,
  ): Promise<Memory[]>;
  bulkCreateAssociations(
    associations: Array<Omit<Association, 'createdAt'>>,
  ): Promise<Association[]>;

  // Decay
  applyDecay(decayRate: number, minScore: number): Promise<number>;
  applyAssociationDecay(decayRate: number, minStrength: number): Promise<number>;

  // API Keys
  getApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  getApiKeysByAgent(agentId: string): Promise<ApiKeyRecord[]>;
  createApiKey(record: Omit<ApiKeyRecord, 'createdAt' | 'lastUsedAt'>): Promise<ApiKeyRecord>;
  revokeApiKey(id: string): Promise<boolean>;
  updateApiKeyLastUsed(id: string): Promise<void>;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}

// ─── Config Types ───────────────────────────────────────

export interface OneMBrainConfig {
  database: {
    provider: 'sqlite' | 'postgres';
    sqlitePath?: string;
    postgresUrl?: string;
  };
  embedding: {
    provider: 'openai' | 'ollama' | 'claude' | 'local-keyword';
    openai?: {
      apiKey: string;
      model: string;
    };
    ollama?: {
      baseUrl: string;
      model: string;
    };
    claude?: {
      apiKey: string;
      model: string;
    };
    localKeyword?: {
      dimensions?: number;
    };
  };
  redis?: {
    url: string;
  };
  decay?: {
    rate: number;
    intervalMs: number;
    minScore: number;
  };
}
