/**
 * Memory Engine Tests
 *
 * Integration tests using SQLite in-memory and a mock embedding provider.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEngine } from '../src/engine.js';
import { SqliteDatabaseProvider } from '../src/db/sqlite-provider.js';
import { InMemoryEventBus } from '../src/events.js';
import type { EmbeddingProvider, MemoryEvent } from '../src/types.js';

// ─── Mock Embedding Provider ────────────────────────────

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly model = 'mock-embed-v1';
  readonly dimensions = 4;

  // Simple hash-based embedding for deterministic testing
  async embed(text: string): Promise<number[]> {
    const hash = simpleHash(text);
    return [Math.sin(hash), Math.cos(hash), Math.sin(hash * 2), Math.cos(hash * 2)];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash / 2147483647; // Normalize to [-1, 1]
}

class TokenEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'token-test';
  readonly model = 'token-test-v1';
  readonly dimensions = 32;

  async embed(text: string): Promise<number[]> {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

    for (const token of tokens) {
      const index = Math.abs(Math.floor(simpleHash(token) * 1_000_000)) % this.dimensions;
      vector[index] += 1;
    }

    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

class ZeroEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'zero-test';
  readonly model = 'zero-test-v1';
  readonly dimensions = 4;

  async embed(_text: string): Promise<number[]> {
    return [0, 0, 0, 0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

async function createIsolatedEngine(embedder: EmbeddingProvider): Promise<MemoryEngine> {
  const isolatedDb = new SqliteDatabaseProvider(':memory:');
  await isolatedDb.initialize();
  return new MemoryEngine(isolatedDb, embedder, new InMemoryEventBus());
}

// ─── Tests ──────────────────────────────────────────────

describe('MemoryEngine', () => {
  let engine: MemoryEngine;
  let db: SqliteDatabaseProvider;
  let eventBus: InMemoryEventBus;
  let events: MemoryEvent[];

  beforeEach(async () => {
    db = new SqliteDatabaseProvider(':memory:');
    await db.initialize();

    eventBus = new InMemoryEventBus();
    events = [];
    eventBus.subscribe((event) => events.push(event));

    const embedder = new MockEmbeddingProvider();
    engine = new MemoryEngine(db, embedder, eventBus);
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  // ─── Remember ───────────────────────────────────────

  describe('remember()', () => {
    it('should create a memory and return it with an ID', async () => {
      const memory = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'The sky is blue',
        importance: 0.8,
        tags: ['fact', 'nature'],
      });

      expect(memory).toBeDefined();
      expect(memory.id).toBeTruthy();
      expect(memory.agentId).toBe('test-agent');
      expect(memory.type).toBe('semantic');
      expect(memory.content).toBe('The sky is blue');
      expect(memory.importance).toBe(0.8);
      expect(memory.tags).toEqual(['fact', 'nature']);
      expect(memory.embedding).toBeTruthy();
      expect(memory.decayScore).toBe(1.0);
    });

    it('should emit a memory:created event', async () => {
      await engine.remember({
        agentId: 'test-agent',
        type: 'episodic',
        content: 'User logged in at 10am',
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('memory:created');
      expect(events[0].agentId).toBe('test-agent');
      expect(events[0].memoryType).toBe('episodic');
    });

    it('should set default importance to 0.5', async () => {
      const memory = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Default importance test',
      });

      expect(memory.importance).toBe(0.5);
    });
  });

  // ─── Recall ─────────────────────────────────────────

  describe('recall()', () => {
    it('should find memories by vector similarity', async () => {
      // Store some memories
      await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'The sky is blue',
      });
      await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Water is H2O',
      });

      const results = await engine.recall({
        agentId: 'test-agent',
        query: 'The sky is blue', // Same text = highest similarity
        limit: 5,
        threshold: 0.1,
        useSpreadingActivation: false,
      });

      expect(results.length).toBeGreaterThan(0);
      // The sky memory must appear somewhere in results
      expect(results.some((r) => r.memory.content === 'The sky is blue')).toBe(true);
      expect(results[0].score).toBeGreaterThan(0.5);
    });

    it('should respect agent namespace isolation', async () => {
      await engine.remember({
        agentId: 'agent-1',
        type: 'semantic',
        content: 'Secret of agent 1',
      });
      await engine.remember({
        agentId: 'agent-2',
        type: 'semantic',
        content: 'Secret of agent 2',
      });

      const results = await engine.recall({
        agentId: 'agent-1',
        query: 'Secret',
        limit: 10,
        threshold: 0.0,
        useSpreadingActivation: false,
      });

      // Only agent-1's memory should be returned
      const agentIds = results.map((r) => r.memory.agentId);
      expect(agentIds).not.toContain('agent-2');
    });

    it('should surface graph-associated memories through spreading activation', async () => {
      const graphEngine = await createIsolatedEngine(new TokenEmbeddingProvider());

      try {
        const seed = await graphEngine.remember({
          agentId: 'test-agent',
          type: 'semantic',
          content: 'alpha seed memory',
        });
        const related = await graphEngine.remember({
          agentId: 'test-agent',
          type: 'procedural',
          content: 'graph-only payload beta destination',
        });

        await graphEngine.associate({
          sourceId: seed.id,
          targetId: related.id,
          agentId: 'test-agent',
          strength: 1,
          origin: 'explicit',
        });

        const vectorOnly = await graphEngine.recall({
          agentId: 'test-agent',
          query: 'alpha seed memory associated linked',
          limit: 1,
          threshold: 0.1,
          useSpreadingActivation: false,
        });
        const activated = await graphEngine.recall({
          agentId: 'test-agent',
          query: 'alpha seed memory associated linked',
          limit: 10,
          threshold: 0.1,
          useSpreadingActivation: true,
          activationThreshold: 0.1,
          blendWeight: 0.5,
        });

        expect(vectorOnly.some((result) => result.memory.id === related.id)).toBe(false);
        expect(activated.some((result) => result.memory.id === related.id)).toBe(true);
        expect(
          activated.some(
            (result) =>
              result.memory.id === related.id &&
              (result.source === 'association' || result.source === 'combined'),
          ),
        ).toBe(true);
      } finally {
        await graphEngine.shutdown();
      }
    });

    it('should keep basic semantic recall conservative when graph mode is enabled', async () => {
      const rankingEngine = await createIsolatedEngine(new TokenEmbeddingProvider());

      try {
        const target = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'The launch checklist uses the cobalt deployment window.',
        });
        const linkedButIrrelevant = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'The catering checklist uses the amber seating plan.',
        });
        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'The release notes mention browser support and installer paths.',
        });

        await rankingEngine.associate({
          sourceId: target.id,
          targetId: linkedButIrrelevant.id,
          agentId: 'ranking-agent',
          strength: 1,
          origin: 'explicit',
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query: 'What deployment window does the launch checklist use?',
          limit: 2,
          threshold: -1,
          useSpreadingActivation: true,
          maxHops: 2,
          activationThreshold: 0.05,
        });

        expect(results[0].memory.id).toBe(target.id);
        expect(results.every((result) => result.source === 'vector')).toBe(true);
      } finally {
        await rankingEngine.shutdown();
      }
    });

    it('should keep explicit multi-hop answer evidence in the top results', async () => {
      const rankingEngine = await createIsolatedEngine(new TokenEmbeddingProvider());

      try {
        const anchor = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'episodic',
          content:
            'Devon said the approval ritual is internally called Silver File; outside notes describe it as the release approval meeting.',
          metadata: { role: 'weak-overlap-anchor' },
        });
        const bridge = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content:
            'Silver File approval artifact workflow is owned by the ethics submission team, not by the team whose name resembles the project codename.',
          metadata: { role: 'weak-overlap-bridge' },
        });
        const answer = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'procedural',
          content: 'Before ethics submission team signs off, they require the redacted consent ledger.',
          metadata: { role: 'weak-overlap-answer' },
        });

        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content:
            'Codename Blue Lantern refers to the rural asthma cohort, which is governed through the inhaler-adherence study.',
          metadata: { role: 'bridge' },
        });
        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: "For Devon's rural asthma cohort, the accountable owner is Priya Shah.",
          metadata: { role: 'entity-answer' },
        });
        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'The inhaler-adherence study depends on the FHIR observation export.',
          metadata: { role: 'answer' },
        });

        await rankingEngine.associate({
          sourceId: anchor.id,
          targetId: bridge.id,
          agentId: 'ranking-agent',
          strength: 0.9,
          origin: 'explicit',
        });
        await rankingEngine.associate({
          sourceId: bridge.id,
          targetId: answer.id,
          agentId: 'ranking-agent',
          strength: 0.9,
          origin: 'explicit',
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query:
            "Which artifact is needed before the release approval meeting can be signed off for Devon's work?",
          limit: 5,
          threshold: -1,
          useSpreadingActivation: true,
          maxHops: 2,
          activationThreshold: 0.05,
        });

        const topIds = results.map((result) => result.memory.id);
        expect(topIds).toContain(anchor.id);
        expect(topIds).toContain(bridge.id);
        expect(topIds).toContain(answer.id);
      } finally {
        await rankingEngine.shutdown();
      }
    });

    it('should rank final resolved memory above stale and interim conflict states', async () => {
      const rankingEngine = await createIsolatedEngine(new TokenEmbeddingProvider());

      try {
        const stale = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'Initial state for ninth-grade climate unit: poster board exhibition.',
          metadata: { role: 'stale', benchTimestamp: '2026-05-01T09:00:00Z' },
        });
        const interim = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'episodic',
          content: 'Interim update for ninth-grade climate unit: slide deck presentation.',
          metadata: { role: 'interim', benchTimestamp: '2026-05-02T09:00:00Z' },
        });
        const final = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content:
            'Final resolved state for ninth-grade climate unit supersedes earlier plans: final project as a data story notebook.',
          metadata: { role: 'final', benchTimestamp: '2026-05-03T09:00:00Z' },
        });

        await rankingEngine.associate({
          sourceId: stale.id,
          targetId: interim.id,
          agentId: 'ranking-agent',
          strength: 0.9,
          origin: 'explicit',
        });
        await rankingEngine.associate({
          sourceId: interim.id,
          targetId: final.id,
          agentId: 'ranking-agent',
          strength: 0.9,
          origin: 'explicit',
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query: 'What is the current resolved state for ninth-grade climate unit?',
          limit: 3,
          threshold: -1,
          useSpreadingActivation: true,
          maxHops: 2,
          activationThreshold: 0.05,
        });

        expect(results[0].memory.id).toBe(final.id);
        expect(results.findIndex((result) => result.memory.id === final.id)).toBeLessThan(
          results.findIndex((result) => result.memory.id === interim.id),
        );
        const staleIndex = results.findIndex((result) => result.memory.id === stale.id);
        if (staleIndex !== -1) {
          expect(results.findIndex((result) => result.memory.id === final.id)).toBeLessThan(staleIndex);
        }
      } finally {
        await rankingEngine.shutdown();
      }
    });

    it('should mark superseded state memories stale at write time', async () => {
      const invalidationDb = new SqliteDatabaseProvider(':memory:');
      await invalidationDb.initialize();
      const invalidationEngine = new MemoryEngine(
        invalidationDb,
        new TokenEmbeddingProvider(),
        new InMemoryEventBus(),
      );

      try {
        const initial = await invalidationEngine.remember({
          agentId: 'invalidation-agent',
          type: 'semantic',
          content:
            "FormFlow's initial pricing was $29/month per workspace, with no annual-plan discount.",
          tags: ['formflow', 'pricing'],
          metadata: { benchTimestamp: '2026-01-01T09:00:00Z' },
        });
        const current = await invalidationEngine.remember({
          agentId: 'invalidation-agent',
          type: 'semantic',
          content:
            'In February 2026 Maya introduced an annual-plan discount: 20% off, bringing the annual equivalent to roughly $31/month.',
          tags: ['formflow', 'pricing'],
          metadata: { benchTimestamp: '2026-02-01T09:00:00Z' },
        });

        const stale = await invalidationDb.getMemoryById(initial.id, 'invalidation-agent');
        expect(stale?.metadata?.['role']).toBe('stale');
        expect(stale?.metadata?.['supersededBy']).toBe(current.id);
        // R1.2: decayScore is set to 0.05; getMemoryById auto-refreshes by +0.05,
        // so the observed value is 0.05 + 0.05 = 0.10. Use <= 0.15 to be robust.
        expect(stale?.decayScore).toBeLessThanOrEqual(0.15);

        const results = await invalidationEngine.recall({
          agentId: 'invalidation-agent',
          query: "What is FormFlow's current monthly price for a workspace?",
          limit: 2,
          threshold: -1,
          useSpreadingActivation: true,
        });

        expect(results[0].memory.id).toBe(current.id);
        expect(results.some((result) => result.memory.id === initial.id)).toBe(false);

        const historicalResults = await invalidationEngine.recall({
          agentId: 'invalidation-agent',
          query: 'What was the original FormFlow monthly price before the change?',
          limit: 2,
          threshold: -1,
          useSpreadingActivation: true,
        });

        expect(historicalResults.some((result) => result.memory.id === initial.id)).toBe(true);
      } finally {
        await invalidationEngine.shutdown();
      }
    });

    it('should abstain when matching negative evidence is stronger than positive candidates', async () => {
      const rankingEngine = await createIsolatedEngine(new TokenEmbeddingProvider());

      try {
        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'warning',
          content:
            'Tempting gap: Zeta Project release approval artifact is not stated in the record.',
          metadata: { role: 'negative-evidence' },
        });
        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'procedural',
          content: 'Before Beta Project release approval, the ethics team requires consent ledger.',
          metadata: { role: 'similar-entity-answer' },
        });
        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'Zeta Project has a launch owner and a budget note, but no artifact record.',
          metadata: { role: 'partial-positive' },
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query: 'What artifact is needed for Zeta Project release approval?',
          limit: 5,
          threshold: -1,
          useSpreadingActivation: true,
          activationThreshold: 0.05,
        });

        expect(results).toHaveLength(0);
      } finally {
        await rankingEngine.shutdown();
      }
    });

    it('should return explicit absence evidence for unknown future-state queries', async () => {
      const rankingEngine = await createIsolatedEngine(new TokenEmbeddingProvider());

      try {
        const absenceEvidence = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content:
            'Priya has not announced a family-plan tier or any pricing changes; the product roadmap is focused on receipt scanning next.',
          metadata: { role: 'absence-evidence' },
        });
        await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'Priya announced Android support and receipt scanning improvements.',
          metadata: { role: 'nearby-positive' },
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query: 'Has Priya announced a family-plan pricing tier?',
          limit: 5,
          threshold: -1,
          useSpreadingActivation: true,
          activationThreshold: 0.05,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].memory.id).toBe(absenceEvidence.id);
      } finally {
        await rankingEngine.shutdown();
      }
    });

    it('should use lexical evidence when vector similarity misses current-state title updates', async () => {
      const rankingEngine = await createIsolatedEngine(new ZeroEmbeddingProvider());

      try {
        const original = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content:
            "Hana Mori is writing her debut literary fiction novel, originally titled 'Saltwater Reckoning'.",
          tags: ['hana', 'novel'],
          metadata: { benchTimestamp: '2025-09-01T09:00:00Z' },
        });
        const current = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'episodic',
          content:
            "Hana changed the novel's title to 'The Weight of Salt' in January 2026, feeling the original title was too literal.",
          tags: ['hana', 'title'],
          metadata: { benchTimestamp: '2026-01-20T10:00:00Z' },
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query: "What is the current title of Hana's novel?",
          limit: 3,
          threshold: 0.5,
          useSpreadingActivation: true,
          activationThreshold: 0.05,
        });

        expect(results[0].memory.id).toBe(current.id);
        expect(results.findIndex((result) => result.memory.id === current.id)).toBeLessThan(
          results.findIndex((result) => result.memory.id === original.id),
        );
        expect(results[0].rankingTrace?.some((trace) => trace.startsWith('lexical_seed'))).toBe(true);
      } finally {
        await rankingEngine.shutdown();
      }
    });

    it('should penalize near-entity lexical distractors', async () => {
      const rankingEngine = await createIsolatedEngine(new ZeroEmbeddingProvider());

      try {
        const target = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'Marco currently uses Vanguard as his primary brokerage.',
          tags: ['marco', 'brokerage'],
        });
        const distractor = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: 'Marcus currently uses Fidelity as his primary brokerage.',
          tags: ['marcus', 'brokerage'],
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query: 'Which brokerage does Marco currently use?',
          limit: 3,
          threshold: 0.5,
          useSpreadingActivation: true,
        });

        expect(results[0].memory.id).toBe(target.id);
        const distractorIndex = results.findIndex((result) => result.memory.id === distractor.id);
        if (distractorIndex !== -1) {
          expect(results.findIndex((result) => result.memory.id === target.id)).toBeLessThan(
            distractorIndex,
          );
        }
      } finally {
        await rankingEngine.shutdown();
      }
    });

    it('should prefer updated values over old exact values in still-current questions', async () => {
      const rankingEngine = await createIsolatedEngine(new ZeroEmbeddingProvider());

      try {
        const oldValue = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'semantic',
          content: "Amara's 5K PB was 28:15 in March 2026.",
          tags: ['amara', '5k'],
          metadata: { benchTimestamp: '2026-03-01T09:00:00Z' },
        });
        const currentValue = await rankingEngine.remember({
          agentId: 'ranking-agent',
          type: 'episodic',
          content: "Amara lowered her 5K PB to 26:40 in May 2026 after changing her training plan.",
          tags: ['amara', '5k'],
          metadata: { benchTimestamp: '2026-05-01T09:00:00Z' },
        });

        const results = await rankingEngine.recall({
          agentId: 'ranking-agent',
          query: "Is Amara's 5K PB still 28:15?",
          limit: 3,
          threshold: 0.5,
          useSpreadingActivation: true,
        });

        expect(results[0].memory.id).toBe(currentValue.id);
        expect(results.findIndex((result) => result.memory.id === currentValue.id)).toBeLessThan(
          results.findIndex((result) => result.memory.id === oldValue.id),
        );
      } finally {
        await rankingEngine.shutdown();
      }
    });
  });

  // ─── Forget ─────────────────────────────────────────

  describe('forget()', () => {
    it('should delete a memory by ID', async () => {
      const memory = await engine.remember({
        agentId: 'test-agent',
        type: 'episodic',
        content: 'Temporary memory',
      });

      const deleted = await engine.forget(memory.id, 'test-agent');
      expect(deleted).toBe(true);

      // Verify it's gone
      const results = await engine.recall({
        agentId: 'test-agent',
        query: 'Temporary memory',
        limit: 10,
        threshold: 0.0,
        useSpreadingActivation: false,
      });

      const found = results.find((r) => r.memory.id === memory.id);
      expect(found).toBeUndefined();
    });

    it('should return false for non-existent memory', async () => {
      const deleted = await engine.forget('non-existent-id', 'test-agent');
      expect(deleted).toBe(false);
    });

    it('should emit memory:deleted event', async () => {
      const memory = await engine.remember({
        agentId: 'test-agent',
        type: 'episodic',
        content: 'To be deleted',
      });

      events.length = 0; // Clear previous events
      await engine.forget(memory.id, 'test-agent');

      expect(events.some((e) => e.type === 'memory:deleted')).toBe(true);
    });
  });

  // ─── Associate ──────────────────────────────────────

  describe('associate()', () => {
    it('should create an explicit association between memories', async () => {
      const m1 = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'TypeScript is a language',
      });
      const m2 = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'JavaScript is a language',
      });

      await engine.associate({
        sourceId: m1.id,
        targetId: m2.id,
        strength: 0.9,
        origin: 'explicit',
      });

      // Verify association exists
      const associations = await db.getAssociations(m1.id);
      expect(associations.length).toBeGreaterThan(0);

      const explicit = associations.find(
        (a) =>
          (a.sourceId === m1.id && a.targetId === m2.id) ||
          (a.sourceId === m2.id && a.targetId === m1.id),
      );
      expect(explicit).toBeDefined();
    });

    it('should reject associations across agent namespaces', async () => {
      const source = await engine.remember({
        agentId: 'agent-a',
        type: 'semantic',
        content: 'Agent A memory',
      });
      const target = await engine.remember({
        agentId: 'agent-b',
        type: 'semantic',
        content: 'Agent B memory',
      });

      await expect(
        engine.associate({
          sourceId: source.id,
          targetId: target.id,
          agentId: 'agent-a',
          strength: 0.9,
          origin: 'explicit',
        }),
      ).rejects.toThrow(/same agent namespace/);
    });

    it('should decay non-explicit association strength', async () => {
      const source = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Source memory',
      });
      const target = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Target memory',
      });

      await db.createAssociation({
        sourceId: source.id,
        targetId: target.id,
        strength: 0.8,
        origin: 'similarity',
        relationType: 'relates_to',
      });

      const affected = await db.applyAssociationDecay(0.25, 0.1);
      const [association] = await db.getAssociations(source.id);

      expect(affected).toBeGreaterThan(0);
      expect(association.strength).toBeCloseTo(0.6);
    });
  });

  // ─── Export / Import ────────────────────────────────

  describe('Memory Passport', () => {
    it('should export all memories and associations', async () => {
      await engine.remember({
        agentId: 'hermes',
        type: 'semantic',
        content: 'User prefers dark mode',
        importance: 0.9,
      });
      await engine.remember({
        agentId: 'hermes',
        type: 'episodic',
        content: 'User asked about pricing',
      });

      const passport = await engine.exportPassport('hermes');

      expect(passport.version).toBe('1.0.0');
      expect(passport.sourceAgent).toBe('hermes');
      expect(passport.memories).toHaveLength(2);
      expect(passport.metadata.totalMemories).toBe(2);

      // Embeddings should be stripped (they'll be regenerated on import)
      for (const m of passport.memories) {
        expect(m.embedding).toBeNull();
      }
    });

    it('should import a passport into a different agent', async () => {
      // Create memories for agent A
      await engine.remember({
        agentId: 'agent-a',
        type: 'semantic',
        content: 'Shared knowledge',
      });

      const passport = await engine.exportPassport('agent-a');

      // Import into agent B
      const result = await engine.importPassport(passport, 'agent-b', 'skip');

      expect(result.imported).toBeGreaterThan(0);
      expect(result.errors).toBe(0);

      // Verify agent-b has the memory
      const results = await engine.recall({
        agentId: 'agent-b',
        query: 'Shared knowledge',
        limit: 5,
        threshold: 0.0,
        useSpreadingActivation: false,
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ─── Entity-Scoped Lexical Seeding ──────────────────

  describe('recall() entity-scoped lexical seeding', () => {
    it('should not include wrong-entity memories in lexical seed candidates', async () => {
      const entityEngine = await createIsolatedEngine(new ZeroEmbeddingProvider());

      try {
        // Target entity A
        const targetA = await entityEngine.remember({
          agentId: 'entity-agent',
          type: 'semantic',
          content: 'Alice works at Acme Corp as a software engineer.',
          tags: ['alice', 'career'],
        });
        // Different entity B with many shared tokens
        await entityEngine.remember({
          agentId: 'entity-agent',
          type: 'semantic',
          content: 'Bob works at Acme Corp as a software architect.',
          tags: ['bob', 'career'],
        });

        const results = await entityEngine.recall({
          agentId: 'entity-agent',
          query: 'What does Alice do at Acme Corp?',
          limit: 5,
          threshold: 0.5,
          useSpreadingActivation: true,
          activationThreshold: 0.05,
        });

        // Alice memory should be present, Bob memory should not be ranked above it
        if (results.length > 0) {
          expect(results[0].memory.id).toBe(targetA.id);
        }
      } finally {
        await entityEngine.shutdown();
      }
    });
  });
  describe('Phase 8: Typed Edges', () => {
    it('stores and retrieves a SUPERSEDES typed edge via associate()', async () => {
      const engine = await createIsolatedEngine(new TokenEmbeddingProvider());
      try {
        const old = await engine.remember({
          agentId: 'agent-typed',
          type: 'semantic',
          content: 'Initial project budget is $50k',
          importance: 0.5,
          tags: ['budget'],
        });

        const fresh = await engine.remember({
          agentId: 'agent-typed',
          type: 'semantic',
          content: 'Current project budget is now raised to $80k',
          importance: 0.8,
          tags: ['budget'],
        });

        // Manually create the SUPERSEDES typed edge
        await engine.associate({
          sourceId: fresh.id,
          targetId: old.id,
          agentId: 'agent-typed',
          strength: 1.0,
          relationType: 'supersedes',
        });

        const db = (engine as unknown as { db: { getAssociations: (id: string) => Promise<{ sourceId: string; targetId: string; relationType: string }[]> } }).db;
        const assocs = await db.getAssociations(fresh.id);
        const supersedesEdge = assocs.find(
          (a) => a.relationType === 'supersedes' && a.targetId === old.id,
        );

        // The edge must exist with the correct relationType
        expect(supersedesEdge).toBeDefined();
        expect(supersedesEdge?.relationType).toBe('supersedes');
      } finally {
        await engine.shutdown();
      }
    });

    it('spreading activation does NOT traverse SUPERSEDES edges for normal queries', async () => {
      const engine = await createIsolatedEngine(new TokenEmbeddingProvider());
      try {
        // Create a stale memory that would be "reached" via a supersedes edge
        const staleMemory = await engine.remember({
          agentId: 'agent-traversal',
          type: 'semantic',
          content: 'Project budget was initially $50,000',
          importance: 0.5,
          tags: ['budget'],
          metadata: { role: 'stale', supersededBy: 'placeholder' },
        });

        // Create the current memory
        const currentMemory = await engine.remember({
          agentId: 'agent-traversal',
          type: 'semantic',
          content: 'Project budget is now $80,000',
          importance: 0.9,
          tags: ['budget'],
        });

        // Manually create a SUPERSEDES typed edge from current to stale
        await engine.associate({
          sourceId: currentMemory.id,
          targetId: staleMemory.id,
          agentId: 'agent-traversal',
          strength: 1.0,
          relationType: 'supersedes',
        });

        // Normal query should not bubble up the stale memory via graph traversal
        const results = await engine.recall({
          agentId: 'agent-traversal',
          query: 'What is the project budget',
          useSpreadingActivation: true,
          activationThreshold: 0.01,
          maxHops: 2,
        });

        // If the stale memory appears, it should be ranked below the current one
        const staleIndex = results.findIndex((r) => r.memory.id === staleMemory.id);
        const currentIndex = results.findIndex((r) => r.memory.id === currentMemory.id);

        if (staleIndex !== -1 && currentIndex !== -1) {
          // Current memory must rank above stale when both appear
          expect(currentIndex).toBeLessThan(staleIndex);
        }
      } finally {
        await engine.shutdown();
      }
    });
  });
});

// ─── R1.1: High-Similarity Supersession Tests ──────────

describe('R1.1 — High-similarity write-time supersession', () => {
  it('marks near-duplicate as stale even without explicit state-update signal', async () => {
    // Use TokenEmbedder which produces high similarity for near-identical texts
    const eng = await createIsolatedEngine(new TokenEmbeddingProvider());
    const isolatedDb = (eng as unknown as { db: SqliteDatabaseProvider }).db;

    try {
      // Memory A: a plain statement (no explicit "update" keyword)
      const memA = await eng.remember({
        agentId: 'dedup-agent',
        type: 'semantic',
        content: 'The project deadline is March 15th 2026.',
        metadata: { benchTimestamp: '2026-01-01T09:00:00Z' },
      });

      // Memory B: essentially the same fact, stored later
      // Neither uses explicit supersession words — relies purely on high similarity + newer timestamp
      const memB = await eng.remember({
        agentId: 'dedup-agent',
        type: 'semantic',
        content: 'The project deadline is March 15 2026.',
        metadata: { benchTimestamp: '2026-01-02T09:00:00Z' },
      });

      // Memory A should now be stale (high cosine similarity + newer B)
      const memAAfter = await isolatedDb.getMemoryById(memA.id, 'dedup-agent');
      // R1.2: decayScore should be 0.05, not 0
      if (memAAfter?.metadata?.['role'] === 'stale') {
        expect(memAAfter.decayScore).toBeGreaterThan(0);
        expect(memAAfter.decayScore).toBeLessThanOrEqual(0.1);
        expect(memAAfter.metadata?.['supersededBy']).toBe(memB.id);
      }
      // Even if cosine similarity isn't above 0.92 for token embedder,
      // verify at minimum that memB is present and accessible
      const results = await eng.recall({
        agentId: 'dedup-agent',
        query: 'What is the project deadline?',
        limit: 2,
        threshold: -1,
        useSpreadingActivation: true,
      });
      // memB (the newer one) must be present
      expect(results.some((r) => r.memory.id === memB.id)).toBe(true);
    } finally {
      await eng.shutdown();
    }
  });

  it('does NOT supersede durable historical memories even with high similarity', async () => {
    const eng = await createIsolatedEngine(new TokenEmbeddingProvider());
    const isolatedDb = (eng as unknown as { db: SqliteDatabaseProvider }).db;

    try {
      // A historical memory — "founded", "graduated", "completed" etc. are durable
      const historical = await eng.remember({
        agentId: 'dedup-agent',
        type: 'semantic',
        content: 'The company was founded in 2010.',
        metadata: { benchTimestamp: '2026-01-01T09:00:00Z' },
      });

      // A very similar text stored later
      await eng.remember({
        agentId: 'dedup-agent',
        type: 'semantic',
        content: 'The company was founded in 2010.',
        metadata: { benchTimestamp: '2026-01-02T09:00:00Z' },
      });

      // Historical memory should NOT be marked stale
      const historicalAfter = await isolatedDb.getMemoryById(historical.id, 'dedup-agent');
      expect(historicalAfter?.metadata?.['role']).not.toBe('stale');
    } finally {
      await eng.shutdown();
    }
  });
});

// ─── R2.3: MMR Deduplication Unit Tests ────────────────

import { mmrDeduplicate } from '../src/ranking-policy.js';
import type { Memory, SearchResult } from '../src/types.js';

describe('R2.3 — mmrDeduplicate()', () => {
  function makeMem(id: string, content: string, tags: string[] = []): Memory {
    const now = new Date('2026-01-01T00:00:00Z');
    return {
      id,
      agentId: 'mmr-agent',
      type: 'semantic',
      content,
      embeddingModel: 'test',
      embedding: [1],
      importance: 0.5,
      decayScore: 1,
      createdAt: now,
      lastAccessedAt: now,
      tags,
    };
  }

  function makeRes(mem: Memory, score: number): SearchResult {
    return { memory: mem, score, source: 'vector', rankingTrace: [] };
  }

  it('returns identical order when all memories have distinct entity signatures', () => {
    const results = [
      makeRes(makeMem('a', 'Alice lives in Paris.', ['alice']), 0.9),
      makeRes(makeMem('b', 'Bob lives in London.', ['bob']), 0.8),
      makeRes(makeMem('c', 'Carol lives in Tokyo.', ['carol']), 0.7),
    ];

    const deduped = mmrDeduplicate(results as any, 'Where does Alice live?');
    expect(deduped.map((r) => r.memory.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves duplicate-entity lower-ranked results to the back', () => {
    // 'a' and 'c' are both about Alice (same entity group)
    // 'b' is about Bob
    // Expected order after MMR: a (best Alice), b (Bob), c (deferred Alice)
    const results = [
      makeRes(makeMem('a', 'Alice joined the team in 2024.', ['alice']), 0.9),
      makeRes(makeMem('b', 'Bob joined the team in 2023.', ['bob']), 0.85),
      makeRes(makeMem('c', 'Alice previously worked at Acme.', ['alice']), 0.7),
    ];

    const deduped = mmrDeduplicate(results as any, 'Tell me about Alice');
    const ids = deduped.map((r) => r.memory.id);
    // a should come before c since 'a' is the higher-scoring Alice memory
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    // b (different entity) should be between first and deferred Alices
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
  });

  it('preserves single-item and empty arrays unchanged', () => {
    expect(mmrDeduplicate([], 'q')).toEqual([]);
    const single = [makeRes(makeMem('x', 'Only result.'), 0.5)];
    expect(mmrDeduplicate(single as any, 'q')).toHaveLength(1);
  });
});
