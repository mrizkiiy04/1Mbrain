/**
 * Ollama Embedding Provider
 *
 * Uses a local Ollama instance for generating embeddings.
 * No API key required — runs entirely on-device.
 */

import type { EmbeddingProvider } from '../types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('ollama-embedding');

const MODEL_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'all-minilm': 384,
  'mxbai-embed-large': 1024,
  'snowflake-arctic-embed': 1024,
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'nomic-embed-text') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.dimensions = MODEL_DIMENSIONS[model] ?? 768;
    log.info({ model, dimensions: this.dimensions, baseUrl: this.baseUrl }, 'Ollama embedding provider initialized');
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    log.debug({ count: texts.length }, 'Embedding batch');

    // Ollama's /api/embed supports batch input
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    return data.embeddings;
  }
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}
