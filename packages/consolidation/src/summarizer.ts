import { getDefaultLLMClient } from '@1mbrain/ingest';
import type { ConsolidatedSummary, LLMClientLike, MemoryCluster } from './types.js';

const SYSTEM_PROMPT = [
  'You consolidate stale episodic memories into one durable semantic memory.',
  'Preserve stable user facts, preferences, procedures, and recurring patterns.',
  'Ignore incidental timestamps unless timing is the point.',
  'Return only JSON with keys: summary, importance, tags, keyFacts.',
].join(' ');

export class ConsolidationSummarizer {
  constructor(private readonly llm: LLMClientLike = getDefaultLLMClient()) {}

  async summarize(cluster: MemoryCluster): Promise<ConsolidatedSummary | null> {
    const result = await this.llm.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(cluster) },
      ],
      true,
    );

    try {
      return normalizeSummary(parseJsonObject(result.content), cluster.sharedTags);
    } catch {
      return null;
    }
  }
}

function buildUserPrompt(cluster: MemoryCluster): string {
  const fragments = cluster.memories
    .map((memory, index) => {
      const tags = memory.tags.length ? ` tags=${memory.tags.join(',')}` : '';
      return `${index + 1}. [${memory.id}] importance=${memory.importance} decay=${memory.decayScore}${tags}\n${memory.content}`;
    })
    .join('\n\n');

  return [
    `Agent: ${cluster.agentId}`,
    `Cluster strategy: ${cluster.strategy}`,
    `Shared tags: ${cluster.sharedTags.join(', ') || 'none'}`,
    'Episodic fragments:',
    fragments,
  ].join('\n');
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON object found');
    }

    return JSON.parse(value.slice(start, end + 1));
  }
}

function normalizeSummary(value: unknown, sharedTags: string[]): ConsolidatedSummary {
  if (!value || typeof value !== 'object') {
    throw new Error('Summary response must be an object');
  }

  const record = value as Record<string, unknown>;
  if (typeof record.summary !== 'string' || record.summary.trim().length === 0) {
    throw new Error('summary is required');
  }

  const llmTags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const keyFacts = Array.isArray(record.keyFacts)
    ? record.keyFacts.filter((fact): fact is string => typeof fact === 'string')
    : [];
  const rawImportance =
    typeof record.importance === 'number' && Number.isFinite(record.importance)
      ? record.importance
      : 0.7;

  return {
    summary: record.summary.trim(),
    importance: Math.min(0.95, Math.max(0.7, rawImportance)),
    tags: [...new Set([...sharedTags, ...llmTags].map((tag) => tag.trim()).filter(Boolean))],
    keyFacts,
  };
}
