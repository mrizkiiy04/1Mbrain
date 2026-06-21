import { describe, expect, it } from 'vitest';
import { createPassportEnvelope, openPassportEnvelope } from '../src/passport.js';
import type { MemoryPassport } from '../src/types.js';

describe('Memory Passport envelope', () => {
  it('should gzip, encrypt, decrypt, and restore a passport', () => {
    const passport: MemoryPassport = {
      version: '1.0.0',
      exportedAt: new Date('2026-06-17T00:00:00.000Z'),
      sourceAgent: 'hermes',
      embeddingModel: 'mock-embed-v1',
      memories: [
        {
          id: 'memory-1',
          agentId: 'hermes',
          type: 'semantic',
          content: 'User prefers Bahasa Indonesia',
          embeddingModel: null,
          embedding: null,
          importance: 0.9,
          decayScore: 0.8,
          createdAt: new Date('2026-06-17T00:00:00.000Z'),
          lastAccessedAt: new Date('2026-06-17T00:01:00.000Z'),
          tags: ['preference'],
        },
      ],
      associations: [
        {
          sourceId: 'memory-1',
          targetId: 'memory-2',
          strength: 0.7,
          origin: 'explicit',
          createdAt: new Date('2026-06-17T00:02:00.000Z'),
        },
      ],
      metadata: {
        totalMemories: 1,
        totalAssociations: 1,
        memoryTypes: {
          episodic: 0,
          semantic: 1,
          procedural: 0,
        },
      },
    };

    const envelope = createPassportEnvelope(passport, 'test-export-key');
    const restored = openPassportEnvelope(envelope, 'test-export-key');

    expect(envelope.format).toBe('1mbrain.passport.envelope');
    expect(envelope.compression).toBe('gzip');
    expect(envelope.encryption.algorithm).toBe('aes-256-gcm');
    expect(envelope.payload).not.toContain('Bahasa Indonesia');
    expect(restored.sourceAgent).toBe('hermes');
    expect(restored.memories[0].content).toBe('User prefers Bahasa Indonesia');
    expect(restored.memories[0].createdAt).toBeInstanceOf(Date);
    expect(restored.associations[0].createdAt).toBeInstanceOf(Date);
  });

  it('should reject the wrong encryption key', () => {
    const passport: MemoryPassport = {
      version: '1.0.0',
      exportedAt: new Date(),
      sourceAgent: 'hermes',
      embeddingModel: 'mock-embed-v1',
      memories: [],
      associations: [],
      metadata: {
        totalMemories: 0,
        totalAssociations: 0,
        memoryTypes: {
          episodic: 0,
          semantic: 0,
          procedural: 0,
        },
      },
    };

    const envelope = createPassportEnvelope(passport, 'correct-key');

    expect(() => openPassportEnvelope(envelope, 'wrong-key')).toThrow();
  });
});
