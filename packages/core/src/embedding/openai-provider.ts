/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's text-embedding API for generating embeddings.
 * Supports batching for efficiency.
 */

import type { EmbeddingProvider } from '../types.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('openai-embedding');

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey: string, model = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = MODEL_DIMENSIONS[model] ?? 1536;
    log.info({ model, dimensions: this.dimensions }, 'OpenAI embedding provider initialized');
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    log.debug({ count: texts.length }, 'Embedding batch');

    let retries = 3;
    let delay = 1000;

    while (retries >= 0) {
      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
          }),
          signal: AbortSignal.timeout(15000), // 15 second timeout to prevent indefinite hang
        });

        if (!response.ok) {
          const error = await response.text();
          if (response.status === 429 && retries > 0) {
            log.warn(`Rate limited (429). Retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            retries--;
            delay *= 2;
            continue;
          }
          throw new Error(`OpenAI embedding error (${response.status}): ${error}`);
        }

        const data = (await response.json()) as OpenAIEmbeddingResponse;
        return data.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      } catch (err: any) {
        if ((err.name === 'TimeoutError' || err.message.includes('fetch')) && retries > 0) {
          log.warn(`Fetch timeout or network error. Retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          retries--;
          delay *= 2;
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to embed batch after multiple retries');
  }
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
