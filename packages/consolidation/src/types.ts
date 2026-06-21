import type { Memory } from '@1mbrain/core';

export type ConsolidationTriggerReason = 'sleep-cycle' | 'threshold';
export type ConsolidationArchiveStrategy = 'decay' | 'delete';
export type ConsolidationClusterStrategy = 'tags' | 'graph' | 'hybrid';

export interface ConsolidationOptions {
  enabled?: boolean;
  cron?: string;
  threshold?: number;
  minAgeDays?: number;
  decayCutoff?: number;
  importanceCutoff?: number;
  archiveStrategy?: ConsolidationArchiveStrategy;
  clusterStrategy?: ConsolidationClusterStrategy;
  minClusterSize?: number;
  maxClusterSize?: number;
  dryRun?: boolean;
  debounceMs?: number;
  rateLimitMs?: number;
}

export interface ResolvedConsolidationOptions {
  enabled: boolean;
  cron: string;
  threshold: number;
  minAgeDays: number;
  decayCutoff: number;
  importanceCutoff: number;
  archiveStrategy: ConsolidationArchiveStrategy;
  clusterStrategy: ConsolidationClusterStrategy;
  minClusterSize: number;
  maxClusterSize: number;
  dryRun: boolean;
  debounceMs: number;
  rateLimitMs: number;
}

export interface MemoryCluster {
  id: string;
  agentId: string;
  memoryIds: string[];
  memories: Memory[];
  sharedTags: string[];
  strategy: ConsolidationClusterStrategy;
}

export interface ConsolidatedSummary {
  summary: string;
  importance: number;
  tags: string[];
  keyFacts: string[];
}

export interface ConsolidationSkipped {
  noCandidates: number;
  tooSmallClusters: number;
  summarizationFailed: number;
  dryRun: number;
}

export interface ConsolidationResult {
  agentId: string;
  triggerReason: ConsolidationTriggerReason;
  dryRun: boolean;
  storedCount: number;
  archivedCount: number;
  clustersProcessed: number;
  skipped: ConsolidationSkipped;
  errors: string[];
  summaryIds: string[];
}

export interface ConsolidationPreview {
  agentId: string;
  candidateCount: number;
  estimatedClusters: number;
  estimatedLLMCalls: number;
}

export interface ConsolidationRunInput extends ConsolidationOptions {
  triggerReason?: ConsolidationTriggerReason;
}

export interface LLMClientLike {
  chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    jsonMode?: boolean,
  ): Promise<{ content: string; finishReason?: string }>;
}

export function resolveConsolidationOptions(
  options: ConsolidationOptions = {},
): ResolvedConsolidationOptions {
  return {
    enabled: options.enabled ?? process.env.CONSOLIDATION_ENABLED !== 'false',
    cron: options.cron ?? process.env.CONSOLIDATION_CRON ?? '0 2 * * *',
    threshold: options.threshold ?? parseInt(process.env.CONSOLIDATION_THRESHOLD ?? '50', 10),
    minAgeDays:
      options.minAgeDays ?? parseInt(process.env.CONSOLIDATION_MIN_AGE_DAYS ?? '7', 10),
    decayCutoff:
      options.decayCutoff ?? parseFloat(process.env.CONSOLIDATION_DECAY_CUTOFF ?? '0.4'),
    importanceCutoff: options.importanceCutoff ?? 0.8,
    archiveStrategy:
      options.archiveStrategy ??
      (process.env.CONSOLIDATION_ARCHIVE_STRATEGY as ConsolidationArchiveStrategy) ??
      'decay',
    clusterStrategy:
      options.clusterStrategy ??
      (process.env.CONSOLIDATION_CLUSTER_STRATEGY as ConsolidationClusterStrategy) ??
      'hybrid',
    minClusterSize: options.minClusterSize ?? 3,
    maxClusterSize: options.maxClusterSize ?? 15,
    dryRun: options.dryRun ?? process.env.CONSOLIDATION_DRY_RUN === 'true',
    debounceMs: options.debounceMs ?? 5 * 60 * 1000,
    rateLimitMs: options.rateLimitMs ?? 10 * 60 * 1000,
  };
}
