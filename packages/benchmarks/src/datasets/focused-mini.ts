import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  BenchmarkCase,
  BenchmarkDataset,
  BenchmarkMemoryRecord,
  BenchmarkMemoryType,
  BenchmarkOperation,
  BenchmarkScenarioType,
} from '../provider.js';

type FixtureMemoryRecord = {
  id: string;
  type: BenchmarkMemoryType;
  timestamp: string;
  content: string;
  tags: string[];
  importance?: number;
  metadata?: Record<string, unknown>;
  associations?: Array<{
    target_id?: string;
    targetId?: string;
    strength: number;
  }>;
};

type FixtureQuestion = {
  question_id: string;
  category: string;
  question: string;
  expected_answer: string;
  required_memory_ids: string[];
  forbidden_memory_ids: string[];
};

type FixtureConversation = {
  conversation_id: string;
  agent_id: string;
  memory_records: FixtureMemoryRecord[];
  questions: FixtureQuestion[];
};

type FocusedMiniFixture = {
  name: string;
  generated_at: string;
  conversations: FixtureConversation[];
};

const CATEGORY_TO_SCENARIO: Record<string, BenchmarkScenarioType> = {
  atomic_fact_recall: 'basic_semantic_recall',
  abstention: 'noise_resistance',
  context_injection: 'agent_task_context',
  contradiction_resolution: 'memory_update',
  current_preference: 'memory_update',
  entity_disambiguation: 'noise_resistance',
  graph_traversal: 'multi_hop_recall',
  multi_hop: 'multi_hop_recall',
  multi_hop_association: 'multi_hop_recall',
  noise_resistance: 'noise_resistance',
  paraphrased_semantic_recall: 'basic_semantic_recall',
  portability: 'portability',
  procedural_recall: 'basic_semantic_recall',
  review_behavior: 'agent_task_context',
  root_cause_recall: 'multi_hop_recall',
  temporal_update: 'memory_update',
};

export function createFocusedMiniDataset(packageRoot: string): BenchmarkDataset {
  return createFixtureDataset(
    packageRoot,
    'fixtures/1mbrain-focused-mini/1mbrain-focused-mini.json',
  );
}

export function createFixtureDataset(packageRoot: string, relativePath: string): BenchmarkDataset {
  const fixturePath = resolve(packageRoot, relativePath);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FocusedMiniFixture;
  const cases: BenchmarkCase[] = [];

  for (const conversation of fixture.conversations) {
    const memories = conversation.memory_records.map(toBenchmarkMemory);

    for (const question of conversation.questions) {
      const scenarioType = CATEGORY_TO_SCENARIO[question.category] ?? 'basic_semantic_recall';
      const operations: BenchmarkOperation[] =
        scenarioType === 'portability'
          ? [
              {
                kind: 'export_import',
                targetAgentId: `${conversation.agent_id}_${question.question_id}_imported`,
              },
            ]
          : [];

      cases.push({
        scenarioId: question.question_id,
        scenarioType,
        title: question.question_id,
        description: `${conversation.conversation_id}: ${question.category}`,
        agentId: `${conversation.agent_id}_${question.question_id}`,
        memories,
        operations,
        question: question.question,
        expectedAnswer: question.expected_answer,
        recallOptions: {
          limit: 10,
          minScore: 0.08,
          maxHops: 3,
          activationThreshold: 0.05,
          blendWeight: 0.45,
        },
        expectations: {
          requiredMemoryIds: question.required_memory_ids,
          forbiddenMemoryIds: question.forbidden_memory_ids,
          shouldAbstain: question.category === 'abstention' ? true : undefined,
          preferredOver: buildPreferredOver(question),
        },
      });
    }
  }

  return {
    name: fixture.name,
    generatedAt: fixture.generated_at,
    cases,
  };
}

function toBenchmarkMemory(memory: FixtureMemoryRecord): BenchmarkMemoryRecord {
  return {
    id: memory.id,
    type: memory.type,
    timestamp: memory.timestamp,
    content: memory.content,
    tags: memory.tags,
    importance: memory.importance,
    metadata: memory.metadata,
    associations: memory.associations?.flatMap((association) => {
      const targetId = association.targetId ?? association.target_id;
      return targetId ? [{ targetId, strength: association.strength }] : [];
    }),
  };
}

function buildPreferredOver(question: FixtureQuestion): BenchmarkCase['expectations']['preferredOver'] {
  if (question.forbidden_memory_ids.length === 0 || question.required_memory_ids.length === 0) {
    return undefined;
  }

  if (!['current_preference', 'contradiction_resolution', 'temporal_update'].includes(question.category)) {
    return undefined;
  }

  return question.required_memory_ids.map((preferredId) => ({
    preferredId,
    competingIds: question.forbidden_memory_ids,
  }));
}
