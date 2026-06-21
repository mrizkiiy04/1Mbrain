/**
 * Embedding Provider Factory
 *
 * Creates the appropriate embedding provider based on configuration.
 */

import type { EmbeddingProvider, OneMBrainConfig } from '../types.js';
import { OpenAIEmbeddingProvider } from './openai-provider.js';
import { OllamaEmbeddingProvider } from './ollama-provider.js';
import { KeywordEmbeddingProvider } from './keyword-provider.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('embedding-factory');

export function createEmbeddingProvider(
  config: OneMBrainConfig['embedding'],
): EmbeddingProvider {
  switch (config.provider) {
    case 'openai': {
      if (!config.openai?.apiKey) {
        throw new Error('OpenAI API key is required for OpenAI embedding provider');
      }
      log.info({ provider: 'openai', model: config.openai.model }, 'Creating OpenAI embedding provider');
      return new OpenAIEmbeddingProvider(config.openai.apiKey, config.openai.model);
    }

    case 'ollama': {
      const baseUrl = config.ollama?.baseUrl || 'http://localhost:11434';
      const model = config.ollama?.model || 'nomic-embed-text';
      log.info({ provider: 'ollama', model, baseUrl }, 'Creating Ollama embedding provider');
      return new OllamaEmbeddingProvider(baseUrl, model);
    }

    case 'claude': {
      // Claude doesn't natively support embeddings yet.
      // When it does, add an adapter here.
      throw new Error(
        'Claude embedding provider is not yet available. ' +
        'Use OpenAI or Ollama for embeddings, or implement a custom adapter.',
      );
    }

    case 'local-keyword': {
      const dimensions = config.localKeyword?.dimensions || 256;
      log.info({ provider: 'local-keyword', dimensions }, 'Creating local keyword embedding provider');
      return new KeywordEmbeddingProvider(dimensions);
    }

    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

export { OpenAIEmbeddingProvider } from './openai-provider.js';
export { OllamaEmbeddingProvider } from './ollama-provider.js';
export { KeywordEmbeddingProvider } from './keyword-provider.js';
