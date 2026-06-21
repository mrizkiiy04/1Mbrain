import type {
  BenchmarkCase,
  BenchmarkDataset,
  BenchmarkMemoryRecord,
  BenchmarkMemoryType,
} from '../provider.js';

const DEFAULT_RECALL_OPTIONS = {
  limit: 5,
  minScore: 0.08,
};

export function createSyntheticAgentMemoryDataset(): BenchmarkDataset {
  const cases: BenchmarkCase[] = [
    ...buildBasicSemanticRecallCases(),
    ...buildMultiHopRecallCases(),
    ...buildMemoryUpdateCases(),
    ...buildNoiseResistanceCases(),
    ...buildSelectiveForgettingCases(),
    ...buildDecayRefreshCases(),
    ...buildPortabilityCases(),
    ...buildAgentTaskContextCases(),
  ];

  return {
    name: 'synthetic-memory-benchmark-v2',
    generatedAt: new Date('2026-06-18T00:00:00.000Z').toISOString(),
    cases,
  };
}

function buildBasicSemanticRecallCases(): BenchmarkCase[] {
  const topics = [
    ['local agent tooling', 'TypeScript', 'PostgreSQL'],
    ['retrieval api', 'TypeScript', 'SQLite'],
    ['memory dashboard', 'React', 'PostgreSQL'],
    ['analytics ingest worker', 'Python', 'PostgreSQL'],
    ['evaluation harness', 'TypeScript', 'SQLite'],
    ['offline assistant', 'Rust', 'SQLite'],
    ['workflow orchestrator', 'TypeScript', 'Redis'],
    ['plugin runtime', 'TypeScript', 'PostgreSQL'],
    ['docs indexing service', 'Python', 'SQLite'],
    ['agent audit trail', 'TypeScript', 'PostgreSQL'],
  ] as const;

  return Array.from({ length: 30 }, (_, index) => {
    const [topic, language, database] = topics[index % topics.length];
    const caseId = `basic_${pad(index + 1)}`;
    const memoryId = `${caseId}_stack`;
    const memories = [
      createMemory(memoryId, 'semantic', isoDay(index), [
        `Preferred stack for ${topic}: ${language} with ${database} for the production build.`,
        [topicToken(topic), language.toLowerCase(), database.toLowerCase(), 'preferred', 'stack'],
      ]),
      ...createGenericNoise(caseId, 3, [`${topic} meeting notes`, 'calendar sync reminder']),
    ];

    return {
      scenarioId: caseId,
      scenarioType: 'basic_semantic_recall',
      title: `Basic semantic recall ${index + 1}`,
      description: `Retrieve the preferred stack for ${topic}.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [],
      question: `What stack is preferred for ${topic}?`,
      expectedAnswer: `${language} and ${database}.`,
      recallOptions: DEFAULT_RECALL_OPTIONS,
      expectations: {
        requiredMemoryIds: [memoryId],
        forbiddenMemoryIds: [],
      },
    };
  });
}

function buildMultiHopRecallCases(): BenchmarkCase[] {
  const projects = [
    ['Kreasa', 'ai mentor app', 'teach users with generated tasks', 'guidance stays too generic'],
    ['PulseBoard', 'ops dashboard', 'coordinate oncall responses', 'alerts lack owner context'],
    ['TraceLamp', 'debug assistant', 'summarize failures for developers', 'root cause summaries are too shallow'],
    ['ForgeFlow', 'coding copilot', 'generate implementation plans', 'diffs ignore repo conventions'],
    ['AtlasNote', 'research workspace', 'connect project findings', 'linked notes miss contradictory evidence'],
    ['RelayDesk', 'support assistant', 'draft customer replies', 'handoff context loses urgency details'],
  ] as const;

  return Array.from({ length: 30 }, (_, index) => {
    const [project, projectType, benefit, weakness] = projects[index % projects.length];
    const caseId = `multihop_${pad(index + 1)}`;
    const memoryA = `${caseId}_identity`;
    const memoryB = `${caseId}_workflow`;
    const memoryC = `${caseId}_weakness`;
    const memories = [
      createMemory(memoryA, 'semantic', isoDay(index), [
        `Project ${project} is the user's ${projectType}.`,
        [project.toLowerCase(), ...projectType.split(' '), 'project'],
      ], [{ targetId: memoryB, strength: 0.92 }]),
      createMemory(memoryB, 'procedural', isoDay(index + 1), [
        `${project} helps users ${benefit}.`,
        [project.toLowerCase(), ...benefit.split(' '), 'workflow'],
      ], [{ targetId: memoryC, strength: 0.9 }]),
      createMemory(memoryC, 'episodic', isoDay(index + 2), [
        `Main weakness this quarter: ${weakness}.`,
        [...weakness.split(' '), 'weakness'],
      ]),
      ...createGenericNoise(caseId, 2, ['marketing banner text', 'cookie notice footer']),
    ];

    return {
      scenarioId: caseId,
      scenarioType: 'multi_hop_recall',
      title: `Multi-hop recall ${index + 1}`,
      description: `Connect ${project} to its weakness through explicit associations.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [],
      question: `What is the main weakness of the user's ${projectType} project ${project}?`,
      expectedAnswer: weakness,
      recallOptions: {
        ...DEFAULT_RECALL_OPTIONS,
        limit: 5,
      },
      expectations: {
        requiredMemoryIds: [memoryA, memoryB, memoryC],
        forbiddenMemoryIds: [],
      },
    };
  });
}

function buildMemoryUpdateCases(): BenchmarkCase[] {
  const projects = ['core benchmark', 'agent sdk', 'support copilot', 'memory passport', 'dashboard build'];
  const oldModels = ['Gemini 2.5 Flash', 'Claude Sonnet', 'Llama 3.1', 'GPT-4.1 mini', 'Mixtral'];
  const newModels = ['DeepSeek V4 Pro', 'Claude Opus', 'Qwen Coder', 'GPT-4.1', 'DeepSeek R1'];

  return Array.from({ length: 30 }, (_, index) => {
    const caseId = `update_${pad(index + 1)}`;
    const project = projects[index % projects.length];
    const oldModel = oldModels[index % oldModels.length];
    const newModel = newModels[index % newModels.length];
    const oldId = `${caseId}_old`;
    const newId = `${caseId}_new`;
    const memories = [
      createMemory(oldId, 'semantic', isoDay(index), [
        `Archived note 2026-05-${pad((index % 20) + 1)}: ${project} used ${oldModel} for coding tasks before the review.`,
        [topicToken(project), ...tokenBag(oldModel), 'archived', 'coding', 'tasks'],
      ]),
      createMemory(newId, 'semantic', isoDay(index + 20), [
        `Current plan 2026-06-${pad((index % 20) + 1)}: ${project} uses ${newModel} for coding focused tasks after the review.`,
        [topicToken(project), ...tokenBag(newModel), 'current', 'coding', 'focused', 'tasks'],
      ]),
      ...createGenericNoise(caseId, 2, ['incident retrospective', 'billing reminder']),
    ];

    return {
      scenarioId: caseId,
      scenarioType: 'memory_update',
      title: `Memory update ${index + 1}`,
      description: `Prefer the newer model decision for ${project}.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [],
      question: `Which model is currently planned for coding focused tasks in ${project}?`,
      expectedAnswer: newModel,
      recallOptions: DEFAULT_RECALL_OPTIONS,
      expectations: {
        requiredMemoryIds: [newId],
        forbiddenMemoryIds: [],
        preferredOver: [
          {
            preferredId: newId,
            competingIds: [oldId],
          },
        ],
      },
    };
  });
}

function buildNoiseResistanceCases(): BenchmarkCase[] {
  const projects = [
    ['Atlas Memory', 'SQLite with PostgreSQL fallback'],
    ['Kreasa Assist', 'PostgreSQL with pgvector'],
    ['Pulse Brain', 'SQLite with local backup'],
    ['Hermes Cache', 'Redis for ephemeral cache only'],
    ['Trace Relay', 'PostgreSQL with nightly export'],
  ] as const;

  return Array.from({ length: 20 }, (_, index) => {
    const [project, storageDecision] = projects[index % projects.length];
    const caseId = `noise_${pad(index + 1)}`;
    const memoryId = `${caseId}_decision`;
    const memories = [
      createMemory(memoryId, 'semantic', isoDay(index), [
        `Decision for ${project}: memory storage will use ${storageDecision} as the primary backend.`,
        [project.toLowerCase().split(' ')[0], 'decision', 'memory', 'storage', ...tokenBag(storageDecision)],
      ]),
      ...createNoiseCluster(caseId, project),
    ];

    return {
      scenarioId: caseId,
      scenarioType: 'noise_resistance',
      title: `Noise resistance ${index + 1}`,
      description: `Ignore project boilerplate and retrieve the real storage decision for ${project}.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [],
      question: `What is the actual project decision about memory storage in ${project}?`,
      expectedAnswer: storageDecision,
      recallOptions: DEFAULT_RECALL_OPTIONS,
      expectations: {
        requiredMemoryIds: [memoryId],
        forbiddenMemoryIds: [],
      },
    };
  });
}

function buildSelectiveForgettingCases(): BenchmarkCase[] {
  const prototypes = [
    ['Kreasa prototype', 'Firebase'],
    ['Atlas note prototype', 'Supabase'],
    ['Relay desk prototype', 'MongoDB'],
    ['Pulse memory prototype', 'Redis'],
    ['Trace lamp prototype', 'DynamoDB'],
  ] as const;

  return Array.from({ length: 20 }, (_, index) => {
    const [prototype, backend] = prototypes[index % prototypes.length];
    const caseId = `forget_${pad(index + 1)}`;
    const memoryId = `${caseId}_removed`;
    const memories = [
      createMemory(memoryId, 'semantic', isoDay(index), [
        `Prototype storage preference for ${prototype}: ${backend} for the first internal demo.`,
        [topicToken(prototype), ...tokenBag(backend), 'prototype', 'storage', 'preference'],
      ]),
      ...createGenericNoise(caseId, 3, ['team lunch reminder', 'wireframe review comment']),
    ];

    return {
      scenarioId: caseId,
      scenarioType: 'selective_forgetting',
      title: `Selective forgetting ${index + 1}`,
      description: `Deleted storage preference for ${prototype} should not leak into recall.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [{ kind: 'forget', memoryId }],
      question: `What backend storage was preferred for the ${prototype}?`,
      expectedAnswer: 'No current memory should be returned after deletion.',
      recallOptions: DEFAULT_RECALL_OPTIONS,
      expectations: {
        requiredMemoryIds: [],
        forbiddenMemoryIds: [memoryId],
        shouldAbstain: true,
      },
    };
  });
}

function buildDecayRefreshCases(): BenchmarkCase[] {
  const projects = [
    ['Atlas memory', 'SQLite with pgvector fallback', 'Redis scratch cache'],
    ['Kreasa planner', 'PostgreSQL with nightly export', 'Firebase scratch store'],
    ['Pulse board', 'SQLite local-first mode', 'MongoDB prototype store'],
    ['Trace relay', 'PostgreSQL durable log', 'Redis event scratchpad'],
    ['Forge flow', 'SQLite embedded mode', 'DynamoDB experiment'],
  ] as const;

  return Array.from({ length: 20 }, (_, index) => {
    const [project, approvedChoice, oldChoice] = projects[index % projects.length];
    const caseId = `decay_${pad(index + 1)}`;
    const approvedId = `${caseId}_approved`;
    const oldId = `${caseId}_old`;
    const sideId = `${caseId}_side`;
    const question = `What memory persistence should ${project} use?`;
    const memories = [
      createMemory(approvedId, 'semantic', isoDay(index), [
        `Approved memory platform for ${project}: ${approvedChoice} is the canonical backend after review.`,
        [topicToken(project), ...tokenBag(approvedChoice), 'approved', 'canonical', 'backend'],
      ]),
      createMemory(oldId, 'episodic', isoDay(index - 5), [
        `Old experiment for ${project}: ${oldChoice} for memory persistence during prototype tests.`,
        [topicToken(project), ...tokenBag(oldChoice), 'old', 'experiment', 'memory', 'persistence', 'prototype'],
      ]),
      createMemory(sideId, 'semantic', isoDay(index + 1), [
        `Side note for ${project}: dashboard color review stayed unchanged.`,
        [topicToken(project), 'dashboard', 'color', 'review'],
      ]),
    ];

    return {
      scenarioId: caseId,
      scenarioType: 'decay_refresh',
      title: `Decay and refresh ${index + 1}`,
      description: `Repeated access should keep the approved choice ahead of the old experiment for ${project}.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [
        {
          kind: 'recall_probe',
          label: 'before_refresh',
          query: question,
          options: DEFAULT_RECALL_OPTIONS,
        },
        {
          kind: 'recall_probe',
          label: 'refresh_target',
          query: `approved memory platform ${project} ${approvedChoice}`,
          repeat: 4,
          options: DEFAULT_RECALL_OPTIONS,
        },
        {
          kind: 'decay',
          cycles: 5,
          decayRate: 0.2,
          minScore: 0.01,
        },
        {
          kind: 'recall_probe',
          label: 'after_refresh',
          query: question,
          options: DEFAULT_RECALL_OPTIONS,
        },
      ],
      question,
      expectedAnswer: approvedChoice,
      recallOptions: DEFAULT_RECALL_OPTIONS,
      expectations: {
        requiredMemoryIds: [approvedId],
        forbiddenMemoryIds: [],
        preferredOver: [
          {
            preferredId: approvedId,
            competingIds: [oldId],
          },
        ],
        probeComparisons: [
          {
            labelBefore: 'before_refresh',
            labelAfter: 'after_refresh',
            memoryId: approvedId,
          },
        ],
      },
    };
  });
}

function buildPortabilityCases(): BenchmarkCase[] {
  const products = [
    ['Atlas Memory', 'local first storage', 'portable memory passport', 'association graph recall'],
    ['Kreasa Mentor', 'specific coaching notes', 'portable project memory', 'semantic summary recall'],
    ['Pulse Brain', 'dashboard event memory', 'portable backup workflow', 'graph expansion recall'],
    ['Trace Relay', 'debug audit memory', 'portable incident ledger', 'linked evidence recall'],
    ['Forge Flow', 'coding decision memory', 'portable build checkpoint', 'task history recall'],
  ] as const;

  return Array.from({ length: 10 }, (_, index) => {
    const [product, storageNote, portabilityNote, recallNote] = products[index % products.length];
    const caseId = `passport_${pad(index + 1)}`;
    const firstId = `${caseId}_storage`;
    const secondId = `${caseId}_portable`;
    const thirdId = `${caseId}_recall`;
    const memories = [
      createMemory(firstId, 'semantic', isoDay(index), [
        `${product} keeps ${storageNote}.`,
        [product.toLowerCase().split(' ')[0], ...storageNote.split(' ')],
      ], [{ targetId: secondId, strength: 0.9 }]),
      createMemory(secondId, 'semantic', isoDay(index + 1), [
        `${product} ships ${portabilityNote}.`,
        [product.toLowerCase().split(' ')[0], ...portabilityNote.split(' ')],
      ], [{ targetId: thirdId, strength: 0.88 }]),
      createMemory(thirdId, 'procedural', isoDay(index + 2), [
        `${product} uses ${recallNote}.`,
        [product.toLowerCase().split(' ')[0], ...recallNote.split(' ')],
      ]),
    ];
    const question = `Which portable memory capabilities does ${product} keep after export and import?`;

    return {
      scenarioId: caseId,
      scenarioType: 'portability',
      title: `Portability ${index + 1}`,
      description: `Export and import should preserve retrievable memory for ${product}.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [
        {
          kind: 'recall_probe',
          label: 'before_export',
          query: question,
          options: DEFAULT_RECALL_OPTIONS,
        },
        {
          kind: 'export_import',
          targetAgentId: `${caseId}_imported_agent`,
        },
      ],
      question,
      expectedAnswer: `${storageNote}, ${portabilityNote}, and ${recallNote}.`,
      recallOptions: DEFAULT_RECALL_OPTIONS,
      expectations: {
        requiredMemoryIds: [firstId, secondId, thirdId],
        forbiddenMemoryIds: [],
        preserveAfterImportIds: [firstId, secondId, thirdId],
      },
    };
  });
}

function buildAgentTaskContextCases(): BenchmarkCase[] {
  const products = [
    ['Atlas Memory', 'engineering teams', 'SQLite and PostgreSQL', 'association graph retrieval', 'quiet operator tone'],
    ['Kreasa Mentor', 'learners and mentors', 'PostgreSQL with backup export', 'semantic coaching recall', 'specific helpful tone'],
    ['Pulse Brain', 'ops teams', 'SQLite local-first storage', 'event graph recall', 'concise operational tone'],
    ['Trace Relay', 'debugging teams', 'PostgreSQL durable audit store', 'linked evidence recall', 'plain diagnostic tone'],
    ['Forge Flow', 'coding agents', 'SQLite embedded mode', 'task history recall', 'direct engineering tone'],
  ] as const;

  return Array.from({ length: 20 }, (_, index) => {
    const [product, audience, storage, retrieval, tone] = products[index % products.length];
    const caseId = `task_${pad(index + 1)}`;
    const memories = [
      createMemory(`${caseId}_audience`, 'semantic', isoDay(index), [
        `${product} serves ${audience}.`,
        [product.toLowerCase().split(' ')[0], ...audience.split(' '), 'audience'],
      ]),
      createMemory(`${caseId}_storage`, 'semantic', isoDay(index + 1), [
        `${product} uses ${storage}.`,
        [product.toLowerCase().split(' ')[0], ...storage.split(' '), 'storage'],
      ]),
      createMemory(`${caseId}_retrieval`, 'procedural', isoDay(index + 2), [
        `${product} relies on ${retrieval}.`,
        [product.toLowerCase().split(' ')[0], ...retrieval.split(' '), 'retrieval'],
      ]),
      createMemory(`${caseId}_tone`, 'semantic', isoDay(index + 3), [
        `${product} should keep a ${tone}.`,
        [product.toLowerCase().split(' ')[0], ...tone.split(' '), 'tone'],
      ]),
      ...createGenericNoise(caseId, 2, ['coupon banner', 'social share prompt']),
    ];
    const requiredIds = memories.slice(0, 4).map((memory) => memory.id);

    return {
      scenarioId: caseId,
      scenarioType: 'agent_task_context',
      title: `Agent task context ${index + 1}`,
      description: `Retrieve the full context needed to draft positioning for ${product}.`,
      agentId: `${caseId}_agent`,
      memories,
      operations: [],
      question: `Prepare positioning context for ${product}: audience storage retrieval tone.`,
      expectedAnswer: `Context should mention ${audience}, ${storage}, ${retrieval}, and ${tone}.`,
      recallOptions: DEFAULT_RECALL_OPTIONS,
      expectations: {
        requiredMemoryIds: requiredIds,
        forbiddenMemoryIds: [],
      },
    };
  });
}

function createMemory(
  id: string,
  type: BenchmarkMemoryType,
  timestamp: string,
  [content, tags]: [string, string[]],
  associations?: Array<{ targetId: string; strength: number }>,
): BenchmarkMemoryRecord {
  return {
    id,
    type,
    timestamp,
    content,
    tags,
    importance: type === 'procedural' ? 0.9 : type === 'semantic' ? 0.82 : 0.7,
    metadata: {
      source: 'synthetic-benchmark',
      timestamp,
    },
    associations,
  };
}

function createGenericNoise(caseId: string, count: number, subjects: string[]): BenchmarkMemoryRecord[] {
  return Array.from({ length: count }, (_, index) =>
    createMemory(`${caseId}_noise_${index + 1}`, 'episodic', isoDay(index + 40), [
      `Noise note ${index + 1}: ${subjects[index % subjects.length]}.`,
      ['noise', ...tokenBag(subjects[index % subjects.length])],
    ]),
  );
}

function createNoiseCluster(caseId: string, project: string): BenchmarkMemoryRecord[] {
  const messages = [
    `Subscribe now for ${project} project decision updates.`,
    `This website uses cookies for ${project} analytics.`,
    `Sponsored content about ${project} storage tutorials.`,
    `Advertisement for project memory storage discounts.`,
    `Click here to unlock the full project decision guide.`,
    `Promotional banner for memory storage webinars.`,
  ];

  return messages.map((message, index) =>
    createMemory(`${caseId}_noise_${index + 1}`, 'episodic', isoDay(index + 50), [
      message,
      ['noise', ...tokenBag(message)],
    ]),
  );
}

function isoDay(dayOffset: number): string {
  const date = new Date(Date.UTC(2026, 5, 1 + dayOffset));
  return date.toISOString();
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function topicToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function tokenBag(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
