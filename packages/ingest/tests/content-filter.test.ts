import { describe, it, expect } from 'vitest';
import { isBlockedUrl, isBlockedClaim, isChunkWorthExtracting } from '../src/content-filter.js';

describe('isBlockedUrl', () => {
  it('should block login URLs', () => {
    expect(isBlockedUrl('https://example.com/login').blocked).toBe(true);
    expect(isBlockedUrl('https://example.com/signin').blocked).toBe(true);
    expect(isBlockedUrl('https://example.com/auth/callback').blocked).toBe(true);
  });

  it('should block checkout/payment URLs', () => {
    expect(isBlockedUrl('https://shop.com/checkout').blocked).toBe(true);
    expect(isBlockedUrl('https://shop.com/cart').blocked).toBe(true);
    expect(isBlockedUrl('https://shop.com/billing').blocked).toBe(true);
  });

  it('should allow normal article URLs', () => {
    expect(isBlockedUrl('https://kompas.com/read/2024/06/tech-news').blocked).toBe(false);
    expect(isBlockedUrl('https://medium.com/@user/great-article').blocked).toBe(false);
    expect(isBlockedUrl('https://github.com/org/repo').blocked).toBe(false);
  });

  it('should block localhost (non-http)', () => {
    expect(isBlockedUrl('https://localhost/admin').blocked).toBe(true);
  });
});

describe('isBlockedClaim', () => {
  it('should block claims containing sensitive keywords', () => {
    expect(isBlockedClaim('Your password has been reset').blocked).toBe(true);
    expect(isBlockedClaim('Enter your API key here').blocked).toBe(true);
    expect(isBlockedClaim('Credit card information required').blocked).toBe(true);
  });

  it('should block marketing copy', () => {
    expect(isBlockedClaim('Subscribe now to get unlimited access').blocked).toBe(true);
    expect(isBlockedClaim('Sign up free and get started today').blocked).toBe(true);
    expect(isBlockedClaim('All rights reserved copyright').blocked).toBe(true);
  });

  it('should block very short claims', () => {
    expect(isBlockedClaim('OK').blocked).toBe(true);
    expect(isBlockedClaim('Read more').blocked).toBe(true);
  });

  it('should allow genuine factual claims', () => {
    expect(isBlockedClaim('1MBrain supports SQLite and PostgreSQL as storage backends.').blocked).toBe(false);
    expect(isBlockedClaim('The new model achieves 94% accuracy on the benchmark dataset.').blocked).toBe(false);
    expect(isBlockedClaim('Python 3.12 was released in October 2023 with major performance improvements.').blocked).toBe(false);
  });
});

describe('isChunkWorthExtracting', () => {
  it('should reject chunks with too few words', () => {
    expect(isChunkWorthExtracting('Hello world. Short.')).toBe(false);
  });

  it('should reject chunks that are mostly headings', () => {
    const headingsOnly = [
      '## Heading One',
      '## Heading Two',
      '## Heading Three',
      '## Heading Four',
      '## Heading Five',
      'some text',
    ].join('\n');
    expect(isChunkWorthExtracting(headingsOnly)).toBe(false);
  });

  it('should accept chunks with meaningful content', () => {
    const good =
      'The 1MBrain memory system uses vector embeddings to store and retrieve factual claims. ' +
      'It supports both SQLite and PostgreSQL backends for production deployments. ' +
      'The spreading activation algorithm walks the association graph to find related memories.';
    expect(isChunkWorthExtracting(good)).toBe(true);
  });
});
