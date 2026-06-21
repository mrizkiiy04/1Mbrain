/**
 * Deterministic local embedding provider.
 *
 * Uses hashed token features so the API can run fully offline without
 * external embedding services. The output is stable across runs.
 */

import type { EmbeddingProvider } from '../types.js';

const DEFAULT_DIMENSIONS = 256;
const TOKEN_RE = /[a-z0-9]+/g;

function normalizeText(text: string): string {
  return text.toLowerCase();
}

function tokenize(text: string): string[] {
  return normalizeText(text).match(TOKEN_RE) ?? [];
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class KeywordEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local-keyword';
  readonly model = 'local-keyword-v1';
  readonly dimensions: number;

  constructor(dimensions: number = DEFAULT_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = tokenize(text);

    if (tokens.length === 0) {
      return vector;
    }

    for (const token of tokens) {
      const hash = hashToken(token);
      const index = hash % this.dimensions;
      const weight = 1 + (hash % 7) * 0.1;
      vector[index] += weight;

      if (token.length > 3) {
        const prefixIndex = hashToken(token.slice(0, 3)) % this.dimensions;
        vector[prefixIndex] += 0.35;
      }
    }

    let norm = 0;
    for (const value of vector) {
      norm += value * value;
    }
    norm = Math.sqrt(norm) || 1;

    return vector.map((value) => value / norm);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}
