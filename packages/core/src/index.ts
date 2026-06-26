/**
 * @1mbrain/core
 *
 * Public API surface for the core package.
 */

// Types
export type {
  Memory,
  MemoryType,
  Association,
  AssociationOrigin,
  AssociationRelationType,
  CreateMemoryInput,
  IngestionSource,
  IngestionSourceClaim,
  SearchMemoryInput,
  SearchResult,
  CreateAssociationInput,
  MemoryPassport,
  MemoryPassportEnvelope,
  EmbeddingProvider,
  DatabaseProvider,
  MemoryEvent,
  MemoryEventType,
  OneMBrainConfig,
} from './types.js';

// Schemas
export {
  CreateMemorySchema,
  SearchMemorySchema,
  CreateAssociationSchema,
  ExportPassportSchema,
  ImportPassportSchema,
  MemoryTypeSchema,
  AssociationOriginSchema,
  AssociationRelationTypeSchema,
} from './schemas.js';

export type {
  CreateMemoryPayload,
  SearchMemoryQuery,
  CreateAssociationPayload,
  ExportPassportPayload,
  ImportPassportPayload,
} from './schemas.js';

// Engine
export { MemoryEngine } from './engine.js';
export { RankingPolicy, analyzeQueryIntent } from './ranking-policy.js';
export type { QueryIntent, RankedSearchResult, RankingOutcome } from './ranking-policy.js';

// Memory Passport
export {
  createPassportEnvelope,
  deserializePassport,
  normalizeEncryptionKey,
  openPassportEnvelope,
  serializePassport,
} from './passport.js';

// Database
export {
  createDatabaseProvider,
  SqliteDatabaseProvider,
  PostgresDatabaseProvider,
} from './db/index.js';

// Embedding
export {
  createEmbeddingProvider,
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
} from './embedding/index.js';

// Events
export { createEventBus, InMemoryEventBus, RedisEventBus } from './events.js';
export type { EventBus, MemoryEventHandler } from './events.js';

// Config
export { loadConfig } from './config.js';

// Logger
export { logger, createChildLogger } from './logger.js';
