import { describe, it, expect, vi } from 'vitest';
import { extractFactsFromChunk } from '../src/fact-extractor.js';
import type { LLMClient } from '../src/llm-client.js';
import type { FactExtractionInput } from '../src/types.js';

const sampleInput: FactExtractionInput = {
  title: '1MBrain Documentation',
  url: 'https://example.com/docs/1mbrain',
  chunkIndex: 0,
  markdown: `
## Storage Backends

1MBrain supports two storage backends:
- **SQLite + sqlite-vec**: Lightweight, single-file, great for local development.
- **PostgreSQL + pgvector**: Production-grade, multi-agent, horizontally scalable.

The embedding model is pluggable — supports OpenAI and Ollama out of the box.
  `.trim(),
};

function makeMockLLM(responseJson: object): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
      finishReason: 'stop',
    }),
  } as unknown as LLMClient;
}

describe('extractFactsFromChunk', () => {
  it('should extract facts from a valid LLM response', async () => {
    const mockLLM = makeMockLLM({
      facts: [
        {
          claim: '1MBrain supports SQLite with sqlite-vec and PostgreSQL with pgvector.',
          type: 'semantic',
          importance: 0.8,
          confidence: 0.92,
          tags: ['1mbrain', 'storage', 'sqlite', 'postgresql'],
          evidence: 'SQLite + sqlite-vec ... PostgreSQL + pgvector',
          shouldRemember: true,
        },
        {
          claim: '1MBrain embedding model is pluggable, supporting OpenAI and Ollama.',
          type: 'semantic',
          importance: 0.75,
          confidence: 0.88,
          tags: ['1mbrain', 'embedding', 'openai', 'ollama'],
          evidence: 'The embedding model is pluggable',
          shouldRemember: true,
        },
      ],
    });

    const facts = await extractFactsFromChunk(sampleInput, mockLLM);

    expect(facts.length).toBe(2);
    expect(facts[0].claim).toContain('1MBrain');
    expect(facts[0].type).toBe('semantic');
    expect(facts[0].confidence).toBeGreaterThanOrEqual(0.75);
    expect(facts[0].shouldRemember).toBe(true);
  });

  it('should apply confidence gate — shouldRemember=false when confidence < 0.75', async () => {
    const mockLLM = makeMockLLM({
      facts: [
        {
          claim: 'This might be true but uncertain.',
          type: 'semantic',
          importance: 0.6,
          confidence: 0.5, // Below gate
          tags: [],
          evidence: 'some text',
          shouldRemember: true, // LLM says yes but confidence overrides
        },
      ],
    });

    const facts = await extractFactsFromChunk(sampleInput, mockLLM);
    expect(facts[0].shouldRemember).toBe(false);
  });

  it('should return empty array for empty facts', async () => {
    const mockLLM = makeMockLLM({ facts: [] });
    const facts = await extractFactsFromChunk(sampleInput, mockLLM);
    expect(facts).toEqual([]);
  });

  it('should return empty array for invalid LLM JSON', async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({ content: 'not valid json', finishReason: 'stop' }),
    } as unknown as LLMClient;

    const facts = await extractFactsFromChunk(sampleInput, mockLLM);
    expect(facts).toEqual([]);
  });

  it('should throw when LLM call fails', async () => {
    const mockLLM = {
      chat: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    } as unknown as LLMClient;

    await expect(extractFactsFromChunk(sampleInput, mockLLM)).rejects.toThrow(
      'LLM call failed',
    );
  });

  it('should sanitize fact tags — lowercase, hyphenated, max 64 chars', async () => {
    const mockLLM = makeMockLLM({
      facts: [
        {
          claim: 'This is a factual claim about database performance.',
          type: 'semantic',
          importance: 0.7,
          confidence: 0.8,
          tags: ['TAG WITH SPACES', 'Another Tag', 'x'.repeat(80)], // Various bad tags
          evidence: 'some evidence',
          shouldRemember: true,
        },
      ],
    });

    const facts = await extractFactsFromChunk(sampleInput, mockLLM);
    expect(facts[0].tags[0]).toBe('tag-with-spaces');
    expect(facts[0].tags[1]).toBe('another-tag');
    expect(facts[0].tags[2].length).toBeLessThanOrEqual(64);
  });

  it('should handle unknown memory type by defaulting to semantic', async () => {
    const mockLLM = makeMockLLM({
      facts: [
        {
          claim: 'This is a fact with unknown type.',
          type: 'made_up_type',
          importance: 0.7,
          confidence: 0.8,
          tags: [],
          evidence: 'evidence',
          shouldRemember: true,
        },
      ],
    });

    const facts = await extractFactsFromChunk(sampleInput, mockLLM);
    expect(facts[0].type).toBe('semantic');
  });
});
