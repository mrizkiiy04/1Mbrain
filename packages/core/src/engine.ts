/**
 * Memory Engine
 *
 * The core of 1MBrain — orchestrates remember, recall, forget, and associate
 * operations. Coordinates between the database provider, embedding provider,
 * and event bus.
 *
 * This is the single entry point that API routes call into.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Memory,
  DatabaseProvider,
  EmbeddingProvider,
  CreateMemoryInput,
  SearchMemoryInput,
  SearchResult,
  CreateAssociationInput,
  MemoryPassport,
  MemoryType,
} from './types.js';
import type { EventBus } from './events.js';
import { createChildLogger } from './logger.js';
import { RankingPolicy, analyzeQueryIntent, significantTokens, tokenCoverage } from './ranking-policy.js';

const log = createChildLogger('memory-engine');
const RRF_K = 60;

export class MemoryEngine {
  private readonly db: DatabaseProvider;
  private readonly embedder: EmbeddingProvider;
  private readonly eventBus: EventBus;
  private readonly rankingPolicy: RankingPolicy;
  private decayInterval: ReturnType<typeof setInterval> | null = null;

  constructor(db: DatabaseProvider, embedder: EmbeddingProvider, eventBus: EventBus) {
    this.db = db;
    this.embedder = embedder;
    this.eventBus = eventBus;
    this.rankingPolicy = new RankingPolicy((memoryId) => this.db.getAssociations(memoryId));
  }

  // ─── Remember ─────────────────────────────────────────

  async remember(input: CreateMemoryInput): Promise<Memory> {
    log.info({ agentId: input.agentId, type: input.type }, 'Remembering...');

    // Generate embedding
    const embedding = await this.embedder.embed(input.content);

    const memory = await this.db.createMemory({
      id: input.id ?? uuidv4(),
      agentId: input.agentId,
      type: input.type,
      content: input.content,
      embeddingModel: this.embedder.model,
      embedding,
      importance: input.importance ?? 0.5,
      decayScore: 1.0,
      tags: input.tags ?? [],
      metadata: input.metadata,
    });

    await this.invalidateSupersededMemories(memory);

    // Create explicit associations if provided
    if (input.associations?.length) {
      for (const assoc of input.associations) {
        try {
          await this.db.createAssociation({
            sourceId: memory.id,
            targetId: assoc.targetId,
            strength: assoc.strength ?? 0.5,
            origin: 'explicit',
            relationType: assoc.relationType ?? 'relates_to',
          });
        } catch (err) {
          log.warn({ err, targetId: assoc.targetId }, 'Failed to create association');
        }
      }
    }

    // Auto-associate with semantically similar memories
    await this.autoAssociate(memory);

    // Emit event
    await this.eventBus.publish({
      type: 'memory:created',
      memoryId: memory.id,
      agentId: memory.agentId,
      memoryType: memory.type,
      timestamp: new Date(),
      data: {
        content: memory.content,
        tags: memory.tags,
        importance: memory.importance,
        decayScore: memory.decayScore,
      },
    });

    return memory;
  }

  // ─── Recall ───────────────────────────────────────────

  private async invalidateSupersededMemories(memory: Memory): Promise<void> {
    if (!memory.embedding) return;

    // R1.1: Broaden search — include candidates even without explicit state-update signal
    // when cosine similarity is very high (same fact expressed differently)
    const isExplicitUpdate = looksLikeStateUpdate(memory);

    const candidates = await this.db.searchByVector(memory.agentId, memory.embedding, {
      // R1.1: Search broader — top 20 candidates at lower threshold to catch near-duplicates
      limit: 20,
      threshold: 0.20,
      type: memory.type,
      // Only apply tag filter for explicit updates; for high-sim supersession, tags may differ
      tags: isExplicitUpdate && memory.tags.length > 0 ? memory.tags : undefined,
    });

    for (const candidate of candidates) {
      const existing = candidate.memory;
      if (existing.id === memory.id) continue;

      const similarity = candidate.similarity;

      // R1.1: High-similarity supersession — same fact, no explicit signal needed
      // If two memories are extremely close (>= 0.92 cosine) and new one is newer, auto-supersede
      const isHighSimilarityDuplicate =
        similarity >= 0.92 &&
        getMemoryTime(memory) > getMemoryTime(existing) &&
        !isStaleMemory(existing) &&
        !isDurableHistoricalMemory(existing);

      const isExplicitSupersession = isExplicitUpdate && shouldSupersede(memory, existing);

      if (!isHighSimilarityDuplicate && !isExplicitSupersession) continue;

      // R1.2: Use 0.05 instead of 0 — keeps memory auditable but heavily penalized
      // decayScore 0 would be exactly 0 in scoring; 0.05 is a tiny non-zero floor
      // that still causes the stale filter to exclude it from normal recall
      await this.db.updateMemory(existing.id, memory.agentId, {
        decayScore: 0.05,
        metadata: {
          ...(existing.metadata ?? {}),
          role: 'stale',
          supersededBy: memory.id,
          supersededAt: new Date().toISOString(),
          supersededReason: isHighSimilarityDuplicate
            ? 'high_similarity_dedup'
            : 'write_time_invalidation',
        },
      });

      await this.db.createAssociation({
        sourceId: memory.id,
        targetId: existing.id,
        strength: 1,
        origin: 'explicit',
        relationType: 'supersedes',
      });
    }
  }

  async recall(input: SearchMemoryInput): Promise<SearchResult[]> {
    log.info({ agentId: input.agentId, query: input.query.slice(0, 50) }, 'Recalling...');
    const limit = input.limit ?? 10;
    const vectorThreshold = input.threshold ?? 0.3;
    const activationThreshold = input.activationThreshold ?? 0.15;
    const blendWeight = input.blendWeight ?? 0.35;
    const queryIntent = analyzeQueryIntent(input.query);
    const includeStaleCandidates =
      input.historyMode === 'all' ||
      (input.historyMode !== 'latest' && shouldIncludeStaleCandidates(input.query));
    const candidateLimit = input.useSpreadingActivation !== false ? Math.max(limit, limit * 3) : limit;
    // R3.3: Increase overfetch multiplier from 4x to 6x so required memories are less likely
    // to be crowded out by distractors before RankingPolicy gets a chance to re-rank them.
    const vectorSearchLimit = includeStaleCandidates ? candidateLimit : candidateLimit * 6;
    // R4.2: Multi-hop Query Decomposition (Heuristic)
    // Extract subqueries if the query looks like a multi-hop question (e.g. "that", "which")
    const subQueries = extractSubQueries(input.query);
    const queryTokens = significantTokens(input.query);
    const isCrossAgent = input.crossAgent || input.agentId === 'all';
    
    const textSearchPromise =
      input.useSpreadingActivation !== false
        ? this.db.searchByText(input.agentId, input.query, {
            limit: Math.max(candidateLimit, limit * 2),
            type: input.type,
            tags: input.tags,
            crossAgent: isCrossAgent,
          })
        : Promise.resolve([]);
    
    // Generate query embedding with lightweight expansion
    // Embeds both the raw query and a slightly reformulated version, then averages them.
    // This improves recall for paraphrase/synonym mismatches without requiring a separate LLM call.
    const queryEmbedding = await this.buildExpandedQueryEmbedding(input.query);

    // Pass 1: Dense vector search plus native sparse text search.
    const [rawVectorResults, rawTextResults] = await Promise.all([
      this.db.searchByVector(input.agentId, queryEmbedding, {
        limit: vectorSearchLimit,
        threshold: vectorThreshold,
        type: input.type,
        tags: input.tags,
        crossAgent: isCrossAgent,
      }),
      textSearchPromise,
    ]);
    const vectorResults = rawVectorResults
      .filter((result) => includeStaleCandidates || !isStaleMemory(result.memory))
      .slice(0, candidateLimit);

    const resultsById = new Map<string, SearchResult>();
    const vectorScores = new Map<string, number>();

    let lexicalResults: Array<{ memory: Memory; score: number }> = [];
    if (input.useSpreadingActivation !== false) {
      lexicalResults = await this.lexicalCandidateSearch(
        input,
        includeStaleCandidates,
        Math.max(candidateLimit, limit * 2),
        rawTextResults,
      );
    }

    const sortedVector = [...vectorResults].sort((a, b) => b.similarity - a.similarity);
    const sortedLexical = [...lexicalResults].sort((a, b) => b.score - a.score);

    const vectorRanks = new Map<string, number>();
    sortedVector.forEach((r, i) => vectorRanks.set(r.memory.id, i + 1));

    const lexicalRanks = new Map<string, number>();
    sortedLexical.forEach((r, i) => lexicalRanks.set(r.memory.id, i + 1));

    const k = 60;
    const rrfBase = 1 / (k + 1);
    const allIds = new Set([...vectorRanks.keys(), ...lexicalRanks.keys()]);

    for (const id of allIds) {
      const vRank = vectorRanks.get(id);
      const lRank = lexicalRanks.get(id);

      const vScoreRrf = vRank ? 1 / (k + vRank) : 0;
      const lScoreRrf = lRank ? 1 / (k + lRank) : 0;

      const rrfScore = vScoreRrf + lScoreRrf;
      const normalizedScore = Math.min(1.0, rrfScore / rrfBase);

      let source: 'vector' | 'lexical' | 'combined' = 'combined';
      if (vRank && !lRank) source = 'vector';
      if (!vRank && lRank) source = 'lexical';

      const memory = vRank
        ? sortedVector.find((r) => r.memory.id === id)!.memory
        : sortedLexical.find((r) => r.memory.id === id)!.memory;

      if (vRank) {
        vectorScores.set(id, sortedVector.find((r) => r.memory.id === id)!.similarity);
      }

      const trace: string[] = [];
      if (vRank) trace.push(`vector_rank:${vRank}`);
      if (lRank) trace.push(`lexical_seed:rrf`);

      resultsById.set(id, {
        memory,
        score: normalizedScore,
        source,
        rankingTrace: trace,
      });
    }
      
    if (input.useSpreadingActivation !== false) {
      // R4.2 Add sub-queries as additional lexical seeds
      for (const subQ of subQueries) {
        const subLexical = await this.lexicalCandidateSearch({ ...input, query: subQ }, includeStaleCandidates, 5);
        for (const result of subLexical) {
          const existing = resultsById.get(result.memory.id);
          const subBoost = result.score * 0.15;
          const trace = `subquery_seed:+${subBoost.toFixed(3)}`;
          
          if (existing) {
            existing.score += subBoost;
            existing.rankingTrace = [...(existing.rankingTrace ?? []), trace];
          } else {
            resultsById.set(result.memory.id, {
              memory: result.memory,
              score: Math.max(0.05, Math.min(0.25, result.score * 0.25)),
              source: 'lexical',
              rankingTrace: [trace],
            });
          }
        }
      }
    }

    // Pass 2: Spreading activation (if enabled and query intent benefits from graph traversal)
    if (
      input.useSpreadingActivation !== false &&
      queryIntent.needsGraphTraversal &&
      resultsById.size > 0
    ) {
      const activationResults = await this.spreadingActivation(
        Array.from(resultsById.values()).map((r) => ({ id: r.memory.id, score: r.score })),
        input.agentId,
        input.maxHops ?? 2,
        activationThreshold,
        true,
        includeStaleCandidates,
        queryTokens, // R4.1 Guided traversal
        input.crossAgent
      );

      for (const activated of activationResults) {
        if (!includeStaleCandidates && isStaleMemory(activated.memory)) continue;
        const vectorScore = vectorScores.get(activated.memory.id);
        const blendedScore =
          vectorScore === undefined
            ? activated.score * blendWeight
            : vectorScore * (1 - blendWeight) + activated.score * blendWeight;

        resultsById.set(activated.memory.id, {
          memory: activated.memory,
          score: blendedScore,
          source: vectorScore === undefined ? 'association' : 'combined',
        });
      }
    }

    const results = [...resultsById.values()];

    const rankedOutcome =
      input.useSpreadingActivation !== false && results.length > 0
        ? await this.rankingPolicy.rank(input.query, results)
        : null;
    const finalResults = rankedOutcome?.abstained ? [] : (rankedOutcome?.results ?? results).slice(0, limit);

    // Emit access events
    for (const result of finalResults) {
      await this.eventBus.publish({
        type: 'memory:accessed',
        memoryId: result.memory.id,
        agentId: input.agentId,
        memoryType: result.memory.type,
        timestamp: new Date(),
        data: {
          content: result.memory.content,
          tags: result.memory.tags,
          score: result.score,
          source: result.source,
          blendWeight,
          rankingTrace: result.rankingTrace,
          importance: result.memory.importance,
          decayScore: result.memory.decayScore,
        },
      });
    }

    // Track co-occurrence for auto-associations
    await this.trackCoOccurrence(finalResults.map((r) => r.memory));

    // Expose metadata on the array for backward compatibility but allow API to read it
    const returnArray = finalResults as any;
    returnArray.confidence = rankedOutcome?.confidence ?? 'high';
    returnArray.abstainedReason = rankedOutcome?.abstainedReason;

    return returnArray;
  }

  private async lexicalCandidateSearch(
    input: SearchMemoryInput,
    includeStaleCandidates: boolean,
    limit: number,
    textCandidates?: Array<{ memory: Memory; score: number }>,
  ): Promise<Array<{ memory: Memory; score: number }>> {
    const queryProfile = buildLexicalProfile(input.query);
    if (queryProfile.tokens.length === 0 && queryProfile.exactTerms.length === 0) return [];

    const queryEntities = queryProfile.entities;
    const hasQueryEntities = queryEntities.length > 0;
    // Raise threshold when query has strong entity signals to reduce forbidden-memory leakage
    const minScore = hasQueryEntities ? 0.36 : 0.32;

    const nativeTextCandidates =
      textCandidates ??
      (await this.db.searchByText(input.agentId, input.query, {
        limit: Math.max(limit * 2, limit),
        type: input.type,
        tags: input.tags,
        crossAgent: input.crossAgent,
      }));
    const textRankById = new Map(
      nativeTextCandidates.map((candidate, index) => [
        candidate.memory.id,
        {
          rank: index + 1,
          score: candidate.score,
        },
      ]),
    );

    const candidates = nativeTextCandidates
      .map((candidate) => candidate.memory)
      .filter((memory) => !input.type || memory.type === input.type)
      .filter((memory) => !input.tags?.length || input.tags.some((tag) => memory.tags.includes(tag)))
      .filter((memory) => includeStaleCandidates || !isStaleMemory(memory))
      .filter((memory) => {
        // Entity-scoped filtering: skip memories that contain conflicting named entities
        // and none of the query entities — they are very likely forbidden/wrong-entity memories
        if (!hasQueryEntities) return true;
        const memoryEntities = extractEntityTerms(memory.content);
        if (memoryEntities.length === 0) return true;
        const hasMatchingEntity = queryEntities.some(
          (qe) => memoryEntities.some((me) => me === qe || me.startsWith(qe) || qe.startsWith(me)),
        );
        if (hasMatchingEntity) return true;
        // Memory has its own entities but none match query entities — likely wrong entity
        return false;
      })
      .map((memory) => {
        const lexicalScore = lexicalEvidenceScore(queryProfile, memory);
        const textRank = textRankById.get(memory.id);
        const normalizedRrf =
          textRank === undefined ? 0 : reciprocalRankScore(textRank.rank) / reciprocalRankScore(1);

        return {
          memory,
          score: lexicalScore * 0.78 + normalizedRrf * 0.22,
          lexicalScore,
        };
      })
      .filter((result) => result.lexicalScore >= minScore);

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
  }

  // ─── Forget ───────────────────────────────────────────

  async forget(memoryId: string, agentId: string): Promise<boolean> {
    log.info({ memoryId, agentId }, 'Forgetting...');

    // Delete associations first (cascade should handle this, but be explicit)
    await this.db.deleteAssociations(memoryId);

    const deleted = await this.db.deleteMemory(memoryId, agentId);

    if (deleted) {
      await this.eventBus.publish({
        type: 'memory:deleted',
        memoryId,
        agentId,
        timestamp: new Date(),
      });
    }

    return deleted;
  }

  // ─── Associate ────────────────────────────────────────

  async resetAgent(agentId: string): Promise<void> {
    log.info({ agentId }, 'Resetting agent memories...');

    const memories = await this.db.getAllMemories(agentId);
    for (const memory of memories) {
      await this.forget(memory.id, agentId);
    }
  }

  async associate(input: CreateAssociationInput): Promise<void> {
    log.info({ sourceId: input.sourceId, targetId: input.targetId }, 'Creating association...');

    if (input.agentId) {
      const [source, target] = await Promise.all([
        this.db.getMemoryById(input.sourceId, input.agentId),
        this.db.getMemoryById(input.targetId, input.agentId),
      ]);

      if (!source || !target) {
        throw new Error('Both associated memories must exist in the same agent namespace');
      }
    }

    await this.db.createAssociation({
      sourceId: input.sourceId,
      targetId: input.targetId,
      strength: input.strength ?? 0.5,
      origin: input.origin ?? 'explicit',
      relationType: input.relationType ?? 'relates_to',
    });

    await this.eventBus.publish({
      type: 'association:created',
      memoryId: input.sourceId,
      agentId: input.agentId ?? '',
      timestamp: new Date(),
      data: { targetId: input.targetId, strength: input.strength },
    });
  }

  // ─── Query Expansion ──────────────────────────────────

  /**
   * Builds an expanded query embedding by averaging the original query embedding
   * with a lightly reformulated version of the query.
   *
   * Improves recall for paraphrase and synonym mismatches at near-zero extra cost.
   * For keyword embedders (sparse), averaging is meaningless so we skip expansion.
   */
  private async buildExpandedQueryEmbedding(query: string): Promise<number[]> {
    const isKeywordEmbedder = this.embedder.model === 'local-keyword';

    // Keyword embedder: expansion has no semantic benefit, skip it
    if (isKeywordEmbedder) {
      return this.embedder.embed(query);
    }

    // Build a lightweight paraphrase of the query using structural templates
    const expanded = expandQuery(query);

    // Embed both versions in parallel
    const [originalEmbedding, expandedEmbedding] = await Promise.all([
      this.embedder.embed(query),
      this.embedder.embed(expanded),
    ]);

    // Average the two embeddings and re-normalise to unit length
    const averaged = originalEmbedding.map((v, i) => (v + (expandedEmbedding[i] ?? 0)) / 2);
    const magnitude = Math.sqrt(averaged.reduce((sum, v) => sum + v * v, 0));
    return magnitude > 0 ? averaged.map((v) => v / magnitude) : averaged;
  }

  // ─── Export (Memory Passport) ─────────────────────────

  async exportPassport(agentId: string): Promise<MemoryPassport> {
    log.info({ agentId }, 'Exporting Memory Passport...');

    const memories = await this.db.getAllMemories(agentId);
    const associations = await this.db.getAllAssociations(agentId);

    const typeCount = memories.reduce(
      (acc, m) => {
        acc[m.type] = (acc[m.type] || 0) + 1;
        return acc;
      },
      {} as Record<MemoryType, number>,
    );

    return {
      version: '1.0.0',
      exportedAt: new Date(),
      sourceAgent: agentId,
      embeddingModel: this.embedder.model,
      memories: memories.map((m) => ({
        ...m,
        // Strip embeddings — they'll be regenerated on import
        embedding: null,
        embeddingModel: null,
      })),
      associations,
      metadata: {
        totalMemories: memories.length,
        totalAssociations: associations.length,
        memoryTypes: typeCount,
      },
    };
  }

  // ─── Import (Memory Passport) ─────────────────────────

  async importPassport(
    passport: MemoryPassport,
    targetAgentId?: string,
    conflictStrategy: 'skip' | 'merge' | 'overwrite' = 'skip',
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const agentId = targetAgentId || passport.sourceAgent;
    log.info(
      { agentId, totalMemories: passport.memories.length, conflictStrategy },
      'Importing Memory Passport...',
    );

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Re-embed all memory content using local embedding model
    const contents = passport.memories.map((m) => m.content);
    let embeddings: number[][];

    try {
      embeddings = await this.embedder.embedBatch(contents);
    } catch (err) {
      log.error({ err }, 'Failed to batch embed during import, falling back to sequential');
      embeddings = [];
      for (const content of contents) {
        try {
          embeddings.push(await this.embedder.embed(content));
        } catch (innerErr) {
          log.error({ innerErr, content: content.slice(0, 50) }, 'Failed to embed');
          embeddings.push([]);
          errors++;
        }
      }
    }

    // Import memories
    const idMapping = new Map<string, string>(); // old ID → new ID

    for (let i = 0; i < passport.memories.length; i++) {
      const m = passport.memories[i];
      const embedding = embeddings[i];

      if (!embedding || embedding.length === 0) {
        errors++;
        continue;
      }

      try {
        // Check for existing memory with same content
        const existing = await this.db.searchByVector(agentId, embedding, {
          limit: 1,
          threshold: 0.98,
        });

        if (existing.length > 0) {
          if (conflictStrategy === 'skip') {
            idMapping.set(m.id, existing[0].memory.id);
            skipped++;
            continue;
          }
          if (conflictStrategy === 'merge') {
            // Update importance to max of both
            await this.db.updateMemory(existing[0].memory.id, agentId, {
              importance: Math.max(existing[0].memory.importance, m.importance),
              tags: [...new Set([...existing[0].memory.tags, ...m.tags])],
            });
            idMapping.set(m.id, existing[0].memory.id);
            imported++;
            continue;
          }
          // overwrite: delete existing, create new
          await this.db.deleteMemory(existing[0].memory.id, agentId);
        }

        const newMemory = await this.db.createMemory({
          id: uuidv4(),
          agentId,
          type: m.type,
          content: m.content,
          embeddingModel: this.embedder.model,
          embedding,
          importance: m.importance,
          decayScore: m.decayScore,
          tags: m.tags,
        });

        idMapping.set(m.id, newMemory.id);
        imported++;
      } catch (err) {
        log.error({ err, memoryId: m.id }, 'Failed to import memory');
        errors++;
      }
    }

    // Import associations with ID remapping
    for (const assoc of passport.associations) {
      const newSourceId = idMapping.get(assoc.sourceId);
      const newTargetId = idMapping.get(assoc.targetId);

      if (newSourceId && newTargetId) {
        try {
          await this.db.createAssociation({
            sourceId: newSourceId,
            targetId: newTargetId,
            strength: assoc.strength,
            origin: assoc.origin,
            relationType: assoc.relationType ?? 'relates_to',
          });
        } catch (err) {
          log.warn({ err }, 'Failed to import association');
        }
      }
    }

    log.info({ imported, skipped, errors }, 'Memory Passport import complete');
    return { imported, skipped, errors };
  }

  // ─── Decay Management ─────────────────────────────────

  startDecayLoop(intervalMs = 3600000, decayRate = 0.01, minScore = 0.01): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
    }

    log.info({ intervalMs, decayRate, minScore }, 'Starting decay loop');

    this.decayInterval = setInterval(async () => {
      try {
        const affected = await this.db.applyDecay(decayRate, minScore);
        const affectedAssociations = await this.db.applyAssociationDecay(decayRate, minScore);
        log.debug({ affected, affectedAssociations }, 'Decay cycle complete');
      } catch (err) {
        log.error({ err }, 'Decay cycle error');
      }
    }, intervalMs);
  }

  stopDecayLoop(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
      log.info('Decay loop stopped');
    }
  }

  // ─── Spreading Activation ─────────────────────────────

  private async spreadingActivation(
    seeds: Array<{ id: string; score: number }>,
    agentId: string,
    maxHops: number,
    threshold: number,
    explicitOnly = false,
    allowStalePaths = false,
    queryTokens: string[] = [],
    crossAgent: boolean = false,
  ): Promise<SearchResult[]> {
    const activated = new Map<string, number>(); // memoryId → activation score
    const expanded = new Set<string>();

    // Initialize activation from seed nodes
    for (const seed of seeds) {
      activated.set(seed.id, seed.score);
    }

    // Walk the graph
    let currentFrontier = seeds.map((s) => s.id);

    for (let hop = 0; hop < maxHops && currentFrontier.length > 0; hop++) {
      const nextFrontier: string[] = [];
      const decayFactor = 1 / (hop + 2); // Activation decays with distance

      for (const nodeId of currentFrontier) {
        if (expanded.has(nodeId)) continue;
        expanded.add(nodeId);

        const nodeActivation = activated.get(nodeId) ?? 0;
        const associations = await this.db.getAssociations(nodeId);

        for (const assoc of associations) {
          if (explicitOnly && assoc.origin !== 'explicit') continue;

          // P2: Skip 'supersedes' edges unless query explicitly asks for historical context
          if (assoc.relationType === 'supersedes' && !allowStalePaths) continue;

          const neighborId = assoc.sourceId === nodeId ? assoc.targetId : assoc.sourceId;
          
          let guidedBoost = 1.0;
          if (queryTokens.length > 0) {
            const memory = await this.db.getMemoryById(neighborId, crossAgent ? undefined : agentId);
            if (memory) {
              const coverage = tokenCoverage(queryTokens, memory.content);
              if (coverage > 0) {
                guidedBoost = 1.0 + Math.min(1.0, coverage * 2.0); // Boost up to 2x for high coverage
              }
            }
          }

          // Propagated activation = parent activation * edge strength * decay * guidedBoost
          const propagated =
            nodeActivation * assoc.strength * associationOriginWeight(assoc.origin) * decayFactor * guidedBoost;
          const current = activated.get(neighborId) ?? 0;

          if (propagated > current) {
            activated.set(neighborId, propagated);
          }

          if (propagated >= threshold && !expanded.has(neighborId)) {
            nextFrontier.push(neighborId);
          }
        }
      }

      currentFrontier = nextFrontier;
    }

    const results: SearchResult[] = [];

    for (const [memoryId, score] of activated) {
      // R2.2 Association Expansion Budget
      if (score < Math.max(threshold, 0.3)) continue;

      const memory = await this.db.getMemoryById(memoryId, crossAgent ? undefined : agentId);
      if (memory) {
        results.push({
          memory,
          score,
          source: 'association',
        });
      }
    }

    return results;
  }

  // ─── Auto-Association ─────────────────────────────────



  private async autoAssociate(memory: Memory): Promise<void> {
    if (!memory.embedding) return;

    // Find semantically similar memories and auto-link
    const similar = await this.db.searchByVector(memory.agentId, memory.embedding, {
      limit: 5,
      threshold: 0.7, // High threshold for auto-association
    });

    for (const match of similar) {
      if (match.memory.id === memory.id) continue;

      try {
        await this.db.createAssociation({
          sourceId: memory.id,
          targetId: match.memory.id,
          strength: match.similarity,
          origin: 'similarity',
          relationType: 'relates_to',
        });
      } catch (err) {
        log.warn({ err, targetId: match.memory.id }, 'Failed to auto-associate');
      }
    }
  }

  // ─── Co-Occurrence Tracking ───────────────────────────

  private async trackCoOccurrence(memories: Memory[]): Promise<void> {
    if (memories.length < 2) return;

    // Create weak associations between memories recalled together
    for (let i = 0; i < memories.length - 1; i++) {
      for (let j = i + 1; j < Math.min(memories.length, i + 4); j++) {
        // Only top pairs
        try {
          await this.db.createAssociation({
            sourceId: memories[i].id,
            targetId: memories[j].id,
            strength: 0.2, // Weak initial co-occurrence strength
            origin: 'co-occurrence',
            relationType: 'relates_to',
          });
        } catch {
          // Silently ignore — these are best-effort
        }
      }
    }
  }

  // ─── Lifecycle ────────────────────────────────────────

  async shutdown(): Promise<void> {
    log.info('Shutting down Memory Engine...');
    this.stopDecayLoop();
    await this.eventBus.close();
    await this.db.close();
    log.info('Memory Engine shut down');
  }
}



function associationOriginWeight(origin: string): number {
  if (origin === 'explicit') return 1;
  if (origin === 'similarity') return 0.35;
  if (origin === 'co-occurrence') return 0.25;
  return 0.3;
}

function looksLikeStateUpdate(memory: Memory): boolean {
  const content = memory.content.toLowerCase();
  const role = String(memory.metadata?.['role'] ?? '').toLowerCase();

  if (role === 'final' || role === 'current') return true;

  return /\b(now|currently|current|latest|final|resolved|after|introduced|raised|lowered|changed|moved|renamed|postponed|pushed back|increased|decreased|no longer|ended|supersedes|replaces)\b/.test(
    content,
  );
}

function shouldSupersede(incoming: Memory, existing: Memory): boolean {
  if (String(existing.metadata?.['role'] ?? '').toLowerCase() === 'stale') return false;
  if (getMemoryTime(incoming) <= getMemoryTime(existing)) return false;
  if (!hasTopicOverlap(incoming, existing)) return false;
  if (!looksLikeSupersedableState(existing)) return false;
  if (isDurableHistoricalMemory(existing)) return false;

  return true;
}

function looksLikeSupersedableState(memory: Memory): boolean {
  const content = memory.content.toLowerCase();
  const role = String(memory.metadata?.['role'] ?? '').toLowerCase();

  if (role === 'stale' || role === 'interim') return true;

  return /\b(initial|originally|original|former|formerly|used to|previously|was priced|was called|was scheduled|no annual-plan discount|no annual discount)\b/.test(
    content,
  );
}

function isDurableHistoricalMemory(memory: Memory): boolean {
  const content = memory.content.toLowerCase();
  return /\bbegan\b|\bfounded\b|\bwas born\b|\bgraduated\b|\bcompleted\b|\bpublished\b/.test(content);
}

function extractSubQueries(query: string): string[] {
  const normalized = query.toLowerCase();
  const subQueries: string[] = [];
  
  // Pattern 1: Relative clauses ("that <verb>", "who <verb>", "which <verb>")
  const relativeMatch = normalized.match(/(.*?)\b(?:that|which|who)\s+([a-z]+(?:\s+[a-z]+){1,3})/i);
  if (relativeMatch) {
    // e.g. "who approved the budget for the project that alice manages"
    // relativeMatch[1] = "who approved the budget for the project "
    // relativeMatch[2] = "alice manages"
    const context = relativeMatch[1]?.split(/\b(?:for|about|on|in)\b/).pop()?.trim() || "";
    if (context.length > 3 && relativeMatch[2]) {
      subQueries.push(`${relativeMatch[2]} ${context}`.trim()); // "alice manages project"
    }
  }

  // Pattern 2: Possessive chaining ("alice's project's budget")
  const possessiveMatch = normalized.match(/\b([a-z]+)'s\s+([a-z]+)\b/i);
  if (possessiveMatch && possessiveMatch[1] && possessiveMatch[2]) {
    subQueries.push(`${possessiveMatch[1]} ${possessiveMatch[2]}`);
  }

  // Fallback: If no explicit structural subquery, and it's long, take the last few words as a context hint
  if (subQueries.length === 0 && normalized.split(/\s+/).length > 6) {
    const parts = normalized.split(/\b(?:for|about|on|with|in)\b/);
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1]?.trim();
      if (lastPart && lastPart.length > 3 && lastPart.split(/\s+/).length <= 4) {
        subQueries.push(lastPart);
      }
    }
  }

  return subQueries;
}

function hasTopicOverlap(a: Memory, b: Memory): boolean {
  const tagOverlap = a.tags.some((tag) => b.tags.includes(tag));
  if (tagOverlap) return true;

  const aTokens = significantMemoryTokens(a.content);
  const bTokens = significantMemoryTokens(b.content);
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }

  return overlap >= 2;
}

function significantMemoryTokens(content: string): Set<string> {
  const stopWords = new Set([
    'about',
    'after',
    'also',
    'and',
    'are',
    'but',
    'for',
    'from',
    'has',
    'have',
    'her',
    'his',
    'in',
    'into',
    'not',
    'now',
    'of',
    'on',
    'the',
    'their',
    'they',
    'this',
    'to',
    'was',
    'with',
  ]);

  return new Set(
    content
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3 && !stopWords.has(token)),
  );
}

interface LexicalProfile {
  tokens: string[];
  exactTerms: string[];
  entities: string[];
}

function buildLexicalProfile(query: string): LexicalProfile {
  return {
    tokens: lexicalTokens(query),
    exactTerms: extractExactTerms(query),
    entities: extractEntityTerms(query),
  };
}

function lexicalEvidenceScore(profile: LexicalProfile, memory: Memory): number {
  const contentTokens = new Set(lexicalTokens(memory.content));
  const tagTokens = new Set(memory.tags.flatMap((tag) => lexicalTokens(tag)));
  const content = memory.content.toLowerCase();
  const tagText = memory.tags.join(' ').toLowerCase();

  const tokenHits = profile.tokens.filter((token) => contentTokens.has(token) || tagTokens.has(token)).length;
  const tokenCoverage = profile.tokens.length > 0 ? tokenHits / profile.tokens.length : 0;

  const exactHits = profile.exactTerms.filter((term) => content.includes(term)).length;
  const exactCoverage = profile.exactTerms.length > 0 ? exactHits / profile.exactTerms.length : 0;

  const entityHits = profile.entities.filter((entity) => content.includes(entity) || tagText.includes(entity)).length;
  const entityCoverage = profile.entities.length > 0 ? entityHits / profile.entities.length : 0;

  const tagHits = profile.tokens.filter((token) => tagTokens.has(token)).length;
  const tagCoverage = profile.tokens.length > 0 ? tagHits / profile.tokens.length : 0;

  let score = tokenCoverage * 0.58 + exactCoverage * 0.22 + entityCoverage * 0.16 + tagCoverage * 0.12;

  if (profile.exactTerms.length > 0 && exactHits === 0 && hasConflictingExactTerm(profile.exactTerms, content)) {
    score -= 0.18;
  }
  if (profile.entities.length > 0 && entityHits === 0 && extractEntityTerms(memory.content).length > 0) {
    score -= 0.16;
  }

  return Math.max(0, Math.min(1, score));
}

function lexicalTokens(text: string): string[] {
  const stopWords = new Set([
    'a',
    'about',
    'after',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'did',
    'does',
    'for',
    'from',
    'has',
    'have',
    'how',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'the',
    'their',
    'there',
    'to',
    'was',
    'what',
    'when',
    'where',
    'whether',
    'which',
    'who',
    'will',
    'with',
  ]);

  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/'s\b/g, '')
        .replace(/[^a-z0-9.$:%/-]+/g, ' ')
        .split(/\s+/)
        .map(normalizeLexicalToken)
        .filter((token) => token.length > 2 && !stopWords.has(token)),
    ),
  );
}

function normalizeLexicalToken(token: string): string {
  if (/^v\d/.test(token)) return token;
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('d') && token.length > 4) return token.slice(0, -1);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

function extractExactTerms(text: string): string[] {
  const normalized = text.toLowerCase();
  const terms = new Set<string>();
  const patterns = [
    /\bv\d+(?:\.\d+)+\b/g,
    /\$\d+(?:,\d{3})*(?:\.\d+)?(?:\/month)?/g,
    /\b\d+(?:,\d{3})*(?:\.\d+)?%(?=\W|$)/g,
    /\b\d+:\d+\b/g,
    /\b\d+(?:,\d{3})+\b/g,
    /\b\d+(?:\.\d+)?\s*(?:mg|episodes|employees|participants|people|targets?)\b/g,
    /\b[A-Za-z]+\s+\d{1,2},?\s+\d{4}\b/g,
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/g,
    /\bglp-\d+\b/g,
    /\bhba1c\b/g,
    /\b\d+k\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.match(pattern) ?? []) {
      terms.add(match);
    }
  }

  for (const quoted of normalized.match(/'[^']+'|"[^"]+"/g) ?? []) {
    terms.add(quoted.slice(1, -1));
  }

  return [...terms];
}

function extractEntityTerms(text: string): string[] {
  const ignored = new Set([
    'did',
    'does',
    'has',
    'how',
    'is',
    'what',
    'when',
    'where',
    'which',
    'who',
    'will',
  ]);
  const terms = new Set<string>();

  for (const match of text.match(/\b[A-Z][a-zA-Z0-9]*(?:['-][A-Z]?[a-zA-Z0-9]+)?\b/g) ?? []) {
    const normalized = match.toLowerCase().replace(/'s$/, '');
    if (normalized.length > 2 && !ignored.has(normalized)) {
      terms.add(normalized);
    }
  }

  for (const quoted of text.match(/"[^"]+"/g) ?? []) {
    const normalized = quoted.slice(1, -1).toLowerCase();
    if (normalized.length > 2) {
      terms.add(normalized);
    }
  }

  return [...terms];
}

function hasConflictingExactTerm(queryTerms: string[], content: string): boolean {
  const contentTerms = extractExactTerms(content);
  if (contentTerms.length === 0) return false;

  return queryTerms.some((queryTerm) =>
    contentTerms.some((contentTerm) => exactTermFamily(queryTerm) === exactTermFamily(contentTerm)),
  );
}

function exactTermFamily(term: string): string {
  if (/^v\d/.test(term)) return 'version';
  if (term.startsWith('$')) return 'money';
  if (term.endsWith('%')) return 'percent';
  if (/^\d+:\d+$/.test(term)) return 'duration';
  if (/\bhba1c\b/.test(term)) return 'code';
  return 'number';
}

function reciprocalRankScore(rank: number): number {
  return 1 / (RRF_K + rank);
}

function getMemoryTime(memory: Memory): number {
  const timestamp = memory.metadata?.['benchTimestamp'];
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }

  return memory.createdAt.getTime();
}

function isStaleMemory(memory: Memory): boolean {
  return (
    String(memory.metadata?.['role'] ?? '').toLowerCase() === 'stale' ||
    memory.metadata?.['supersededBy'] !== undefined
  );
}

function shouldIncludeStaleCandidates(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(previous|original|former|formerly|used to|what changed|change from|changed from|prior|earlier|old value|old state|history|historical)\b/.test(
    normalized,
  );
}

/**
 * Lightweight query expansion for embedding-based retrieval.
 *
 * Converts a question into a declarative form that is closer in embedding space
 * to the stored memory documents. For example:
 *   "When did the project start?" → "The project started on [date]. When did the project start?"
 *
 * This is a deterministic alternative to full HyDE (which requires LLM inference)
 * and costs only one extra embed() call.
 */
function expandQuery(query: string): string {
  const q = query.trim();
  const lower = q.toLowerCase();

  // Strip leading question words and reformulate as declarative statement
  const declarative = q
    .replace(/^when\s+(did|was|were|is|are|has|have)\s+/i, 'The time that ')
    .replace(/^what\s+(is|was|were|are|did|has|have)\s+/i, 'Information about ')
    .replace(/^who\s+(is|was|were|are|did)\s+/i, 'The person who ')
    .replace(/^where\s+(is|was|were|are|did)\s+/i, 'The location where ')
    .replace(/^why\s+(is|was|were|are|did|has|have)\s+/i, 'The reason why ')
    .replace(/^how\s+(is|was|were|are|did|has|have|many|much|long|often)\s+/i, 'Details on how ')
    .replace(/^which\s+/i, 'The specific ')
    .replace(/\?$/, '');

  // If transformation had no effect (no question words), just append a suffix to hint doc-like text
  if (declarative.toLowerCase() === lower.replace(/\?$/, '')) {
    return `${q} — relevant memory about ${q.replace(/\?$/, '').trim()}`;
  }

  // Combine declarative + original to capture both document and query semantics
  return `${declarative}. ${q}`;
}
