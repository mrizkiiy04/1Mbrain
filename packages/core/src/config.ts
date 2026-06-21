/**
 * Config Loader
 *
 * Reads environment variables and constructs a typed OneMBrainConfig.
 */

import type { OneMBrainConfig } from './types.js';

export function loadConfig(): OneMBrainConfig {
  return {
    database: {
      provider: (process.env.DB_PROVIDER as 'sqlite' | 'postgres') || 'sqlite',
      sqlitePath: process.env.SQLITE_PATH || './data/1mbrain.db',
      postgresUrl: process.env.DATABASE_URL,
    },
    embedding: {
      provider: (process.env.EMBEDDING_PROVIDER as 'openai' | 'ollama' | 'claude' | 'local-keyword') ||
        (process.env.OPENAI_API_KEY ? 'openai' : 'local-keyword'),
      openai: process.env.OPENAI_API_KEY
        ? {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
          }
        : undefined,
      ollama: {
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        model: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
      },
      claude: process.env.ANTHROPIC_API_KEY
        ? {
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: process.env.ANTHROPIC_EMBEDDING_MODEL || '',
          }
        : undefined,
      localKeyword: {
        dimensions: process.env.LOCAL_KEYWORD_EMBEDDING_DIMENSIONS
          ? parseInt(process.env.LOCAL_KEYWORD_EMBEDDING_DIMENSIONS, 10)
          : undefined,
      },
    },
    redis: process.env.REDIS_URL
      ? { url: process.env.REDIS_URL }
      : undefined,
    decay: {
      rate: parseFloat(process.env.DECAY_RATE || '0.01'),
      intervalMs: parseInt(process.env.DECAY_INTERVAL_MS || '3600000', 10),
      minScore: parseFloat(process.env.DECAY_MIN_SCORE || '0.01'),
    },
  };
}
