import type { DatabaseProvider, EventBus, MemoryEngine } from '@1mbrain/core';
import { createChildLogger } from '@1mbrain/core';
import { MemoryClusterer } from './memory-clusterer.js';
import { ConsolidationSummarizer } from './summarizer.js';
import {
  type ConsolidationOptions,
  type ConsolidationPreview,
  type ConsolidationResult,
  type ConsolidationRunInput,
  type MemoryCluster,
  resolveConsolidationOptions,
} from './types.js';

const log = createChildLogger('consolidation-engine');

interface ClustererLike {
  findCandidates(agentId: string, options?: ConsolidationOptions): Promise<unknown[]>;
  findClusters(agentId: string, options?: ConsolidationOptions): Promise<MemoryCluster[]>;
}

interface SummarizerLike {
  summarize(cluster: MemoryCluster): Promise<{
    summary: string;
    importance: number;
    tags: string[];
    keyFacts: string[];
  } | null>;
}

export class ConsolidationEngine {
  constructor(
    private readonly memoryEngine: MemoryEngine,
    private readonly db: DatabaseProvider,
    private readonly eventBus: EventBus,
    private readonly clusterer: ClustererLike = new MemoryClusterer(db),
    private readonly summarizer: SummarizerLike = new ConsolidationSummarizer(),
  ) {}

  async preview(agentId: string, options: ConsolidationOptions = {}): Promise<ConsolidationPreview> {
    const candidates = await this.clusterer.findCandidates(agentId, options);
    const clusters = await this.clusterer.findClusters(agentId, options);

    return {
      agentId,
      candidateCount: candidates.length,
      estimatedClusters: clusters.length,
      estimatedLLMCalls: clusters.length,
    };
  }

  async run(agentId: string, input: ConsolidationRunInput = {}): Promise<ConsolidationResult> {
    const options = resolveConsolidationOptions(input);
    const triggerReason = input.triggerReason ?? 'threshold';
    const clusters = await this.clusterer.findClusters(agentId, options);
    const result: ConsolidationResult = {
      agentId,
      triggerReason,
      dryRun: options.dryRun,
      storedCount: 0,
      archivedCount: 0,
      clustersProcessed: 0,
      skipped: {
        noCandidates: clusters.length === 0 ? 1 : 0,
        tooSmallClusters: 0,
        summarizationFailed: 0,
        dryRun: 0,
      },
      errors: [],
      summaryIds: [],
    };

    for (const cluster of clusters) {
      try {
        const summary = await this.summarizer.summarize(cluster);
        if (!summary) {
          result.skipped.summarizationFailed++;
          continue;
        }

        result.clustersProcessed++;

        if (options.dryRun) {
          result.skipped.dryRun += cluster.memoryIds.length;
          continue;
        }

        const stored = await this.memoryEngine.remember({
          agentId,
          type: 'semantic',
          content: summary.summary,
          importance: summary.importance,
          tags: summary.tags,
          metadata: {
            consolidatedFrom: cluster.memoryIds,
            consolidatedAt: new Date().toISOString(),
            sourceCount: cluster.memoryIds.length,
            triggerReason,
            clusterStrategy: cluster.strategy,
            keyFacts: summary.keyFacts,
          },
        });

        // P3: Create 'derived_from' typed edges from summary to each source memory
        for (const sourceId of cluster.memoryIds) {
          try {
            await this.memoryEngine.associate({
              sourceId: stored.id,
              targetId: sourceId,
              agentId,
              strength: 0.8,
              relationType: 'derived_from',
            });
          } catch {
            // Non-fatal: best-effort lineage edge
          }
        }

        result.storedCount++;
        result.summaryIds.push(stored.id);
        result.archivedCount += await this.archiveCluster(agentId, cluster.memoryIds, stored.id, options);

        await this.eventBus.publish({
          type: 'memory:consolidated',
          memoryId: stored.id,
          agentId,
          memoryType: 'semantic',
          timestamp: new Date(),
          data: {
            sourceCount: cluster.memoryIds.length,
            sourceIds: cluster.memoryIds,
            summaryId: stored.id,
            triggerReason,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ err, agentId, clusterId: cluster.id }, 'Cluster consolidation failed');
        result.errors.push(message);
      }
    }

    return result;
  }

  private async archiveCluster(
    agentId: string,
    memoryIds: string[],
    summaryId: string,
    options: ReturnType<typeof resolveConsolidationOptions>,
  ): Promise<number> {
    let archived = 0;

    for (const memoryId of memoryIds) {
      if (options.archiveStrategy === 'delete') {
        if (await this.memoryEngine.forget(memoryId, agentId)) {
          archived++;
        }
        continue;
      }

      const existing = await this.db.getMemoryById(memoryId, agentId);
      if (!existing) {
        continue;
      }

      const updated = await this.db.updateMemory(memoryId, agentId, {
        decayScore: 0,
        metadata: {
          ...(existing.metadata ?? {}),
          archivedByConsolidation: true,
          consolidatedInto: summaryId,
          archivedAt: new Date().toISOString(),
        },
      });

      if (updated) {
        archived++;
      }
    }

    return archived;
  }
}
