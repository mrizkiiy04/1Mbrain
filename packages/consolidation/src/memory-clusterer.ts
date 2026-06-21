import type { Association, DatabaseProvider, Memory } from '@1mbrain/core';
import {
  type ConsolidationClusterStrategy,
  type ConsolidationOptions,
  type MemoryCluster,
  resolveConsolidationOptions,
} from './types.js';

export class MemoryClusterer {
  constructor(private readonly db: DatabaseProvider) {}

  async findCandidates(agentId: string, options: ConsolidationOptions = {}): Promise<Memory[]> {
    const resolved = resolveConsolidationOptions(options);
    const cutoffTime = Date.now() - resolved.minAgeDays * 24 * 60 * 60 * 1000;
    const memories = await this.db.getAllMemories(agentId);

    return memories.filter((memory) => {
      if (memory.type !== 'episodic') return false;
      if (memory.decayScore >= resolved.decayCutoff) return false;
      if (memory.importance >= resolved.importanceCutoff) return false;
      if (memory.createdAt.getTime() > cutoffTime) return false;
      if (memory.metadata?.['archivedByConsolidation']) return false;
      return true;
    });
  }

  async findClusters(agentId: string, options: ConsolidationOptions = {}): Promise<MemoryCluster[]> {
    const resolved = resolveConsolidationOptions(options);
    const candidates = await this.findCandidates(agentId, resolved);
    if (candidates.length < resolved.minClusterSize) {
      return [];
    }

    if (resolved.clusterStrategy === 'tags') {
      return this.clusterByTags(agentId, candidates, resolved);
    }

    if (resolved.clusterStrategy === 'graph') {
      const associations = await this.db.getAllAssociations(agentId);
      return this.clusterByGraph(agentId, candidates, associations, resolved);
    }

    const associations = await this.db.getAllAssociations(agentId);
    const combined = [
      ...this.clusterByTags(agentId, candidates, resolved),
      ...this.clusterByGraph(agentId, candidates, associations, resolved),
    ];

    return dedupeClusters(combined);
  }

  private clusterByTags(
    agentId: string,
    memories: Memory[],
    options: ReturnType<typeof resolveConsolidationOptions>,
  ): MemoryCluster[] {
    const groups = new Map<string, Memory[]>();

    for (const memory of memories) {
      const key = normalizeTags(memory.tags).join('|') || '__untagged__';
      const current = groups.get(key) ?? [];
      current.push(memory);
      groups.set(key, current);
    }

    return [...groups.values()].flatMap((group) =>
      this.toSizedClusters(agentId, group, 'tags', options),
    );
  }

  private clusterByGraph(
    agentId: string,
    memories: Memory[],
    associations: Association[],
    options: ReturnType<typeof resolveConsolidationOptions>,
  ): MemoryCluster[] {
    const candidateIds = new Set(memories.map((memory) => memory.id));
    const byId = new Map(memories.map((memory) => [memory.id, memory]));
    const adjacency = new Map<string, Set<string>>();

    for (const memory of memories) {
      adjacency.set(memory.id, new Set());
    }

    for (const association of associations) {
      if (!candidateIds.has(association.sourceId) || !candidateIds.has(association.targetId)) {
        continue;
      }

      adjacency.get(association.sourceId)?.add(association.targetId);
      adjacency.get(association.targetId)?.add(association.sourceId);
    }

    const visited = new Set<string>();
    const components: Memory[][] = [];

    for (const memory of memories) {
      if (visited.has(memory.id)) continue;

      const stack = [memory.id];
      const component: Memory[] = [];
      visited.add(memory.id);

      while (stack.length > 0) {
        const current = stack.pop() as string;
        const currentMemory = byId.get(current);
        if (currentMemory) {
          component.push(currentMemory);
        }

        for (const next of adjacency.get(current) ?? []) {
          if (!visited.has(next)) {
            visited.add(next);
            stack.push(next);
          }
        }
      }

      components.push(component);
    }

    return components.flatMap((group) => this.toSizedClusters(agentId, group, 'graph', options));
  }

  private toSizedClusters(
    agentId: string,
    memories: Memory[],
    strategy: ConsolidationClusterStrategy,
    options: ReturnType<typeof resolveConsolidationOptions>,
  ): MemoryCluster[] {
    if (memories.length < options.minClusterSize) {
      return [];
    }

    const sorted = [...memories].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const clusters: MemoryCluster[] = [];

    for (let start = 0; start < sorted.length; start += options.maxClusterSize) {
      const chunk = sorted.slice(start, start + options.maxClusterSize);
      if (chunk.length < options.minClusterSize) {
        continue;
      }

      clusters.push({
        id: `${agentId}:${strategy}:${chunk.map((memory) => memory.id).sort().join(',')}`,
        agentId,
        memoryIds: chunk.map((memory) => memory.id),
        memories: chunk,
        sharedTags: sharedTags(chunk),
        strategy,
      });
    }

    return clusters;
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

function sharedTags(memories: Memory[]): string[] {
  if (memories.length === 0) return [];

  let intersection = new Set(normalizeTags(memories[0].tags));
  for (const memory of memories.slice(1)) {
    const tags = new Set(normalizeTags(memory.tags));
    intersection = new Set([...intersection].filter((tag) => tags.has(tag)));
  }

  if (intersection.size > 0) {
    return [...intersection];
  }

  return normalizeTags(memories.flatMap((memory) => memory.tags)).slice(0, 8);
}

function dedupeClusters(clusters: MemoryCluster[]): MemoryCluster[] {
  const seen = new Set<string>();
  const deduped: MemoryCluster[] = [];

  for (const cluster of clusters.sort((a, b) => b.memoryIds.length - a.memoryIds.length)) {
    const key = [...cluster.memoryIds].sort().join('|');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(cluster);
  }

  return deduped;
}
