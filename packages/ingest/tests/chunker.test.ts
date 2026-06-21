import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../src/chunker.js';

describe('chunkMarkdown', () => {
  it('should return empty array for blank content', () => {
    const result = chunkMarkdown('');
    expect(result).toEqual([]);
  });

  it('should return empty array for very short content', () => {
    const result = chunkMarkdown('Short.');
    expect(result).toEqual([]);
  });

  it('should chunk on heading boundaries', () => {
    const md = `
## Section One
This is the first section with some content about topic A.
It has multiple sentences and is long enough to be meaningful.

## Section Two
This is the second section with content about topic B.
It also has multiple sentences for meaningful context.
    `.trim();

    const result = chunkMarkdown(md, 1800);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].content).toContain('Section One');
    expect(result[1].content).toContain('Section Two');
  });

  it('should split large sections at sentence boundaries', () => {
    // Build a section that exceeds maxChars
    const longContent =
      '## Big Section\n' +
      Array(50).fill('This is a long sentence that adds to the total character count significantly.').join(' ');

    const result = chunkMarkdown(longContent, 500);
    expect(result.length).toBeGreaterThan(1);
    result.forEach((chunk) => {
      expect(chunk.content.length).toBeLessThanOrEqual(600); // Some tolerance
    });
  });

  it('should re-index chunks sequentially', () => {
    const md = `
## A
Long enough content here for section A to be valid for chunking.

## B
Long enough content here for section B to be valid for chunking.

## C
Long enough content here for section C to be valid for chunking.
    `.trim();

    const result = chunkMarkdown(md, 1800);
    result.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it('should fall back to paragraph chunking for flat documents', () => {
    const md = [
      'First paragraph with enough words to be meaningful for factual extraction.',
      'Second paragraph with enough words to be meaningful for factual extraction.',
      'Third paragraph with enough words to be meaningful for factual extraction.',
    ].join('\n\n');

    const result = chunkMarkdown(md, 1800);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('should set correct chunk index', () => {
    const md = [
      '## Section Alpha',
      'This section contains enough words to meet the minimum chunk character threshold for indexing.',
      '',
      '## Section Beta',
      'This section also contains enough words to meet the minimum chunk character threshold for indexing.',
    ].join('\n');
    const result = chunkMarkdown(md, 1800);
    expect(result.length).toBeGreaterThanOrEqual(1);
    result.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });
});
