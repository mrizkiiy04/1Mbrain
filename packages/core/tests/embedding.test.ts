/**
 * Embedding Provider Tests
 *
 * Mocks global fetch to test OpenAI and Ollama adapters without real API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIEmbeddingProvider } from '../src/embedding/openai-provider.js';
import { OllamaEmbeddingProvider } from '../src/embedding/ollama-provider.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Embedding Providers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('OpenAIEmbeddingProvider', () => {
    it('should embed a single text correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      });

      const provider = new OpenAIEmbeddingProvider('fake-key', 'text-embedding-3-small');
      const result = await provider.embed('Hello world');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.openai.com/v1/embeddings');
      expect(callArgs[1].headers.Authorization).toBe('Bearer fake-key');
      expect(JSON.parse(callArgs[1].body)).toEqual({
        model: 'text-embedding-3-small',
        input: ['Hello world'],
      });
    });

    it('should embed a batch of texts correctly and preserve order', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.4, 0.5], index: 1 },
            { embedding: [0.1, 0.2], index: 0 },
          ],
        }),
      });

      const provider = new OpenAIEmbeddingProvider('fake-key');
      const result = await provider.embedBatch(['First', 'Second']);

      expect(result).toEqual([[0.1, 0.2], [0.4, 0.5]]);
    });

    it('should throw an error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid API Key',
      });

      const provider = new OpenAIEmbeddingProvider('fake-key');
      await expect(provider.embed('Test')).rejects.toThrow('OpenAI embedding error (401): Invalid API Key');
    });
  });

  describe('OllamaEmbeddingProvider', () => {
    it('should embed a single text correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'nomic-embed-text',
          embeddings: [[0.5, 0.6, 0.7]],
        }),
      });

      const provider = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic-embed-text');
      const result = await provider.embed('Hello world');

      expect(result).toEqual([0.5, 0.6, 0.7]);
      
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('http://localhost:11434/api/embed');
      expect(JSON.parse(callArgs[1].body)).toEqual({
        model: 'nomic-embed-text',
        input: 'Hello world',
      });
    });

    it('should handle trailing slashes in base URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.1]] }),
      });

      const provider = new OllamaEmbeddingProvider('http://127.0.0.1:11434/');
      await provider.embed('Test');

      expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/embed');
    });

    it('should throw an error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const provider = new OllamaEmbeddingProvider();
      await expect(provider.embed('Test')).rejects.toThrow('Ollama embedding error (500): Internal Server Error');
    });
  });
});
