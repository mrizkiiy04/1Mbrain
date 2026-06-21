export type BenchmarkMemoryType = 'episodic' | 'semantic' | 'procedural';

export type BenchmarkScenarioType =
  | 'basic_semantic_recall'
  | 'multi_hop_recall'
  | 'memory_update'
  | 'noise_resistance'
  | 'selective_forgetting'
  | 'decay_refresh'
  | 'portability'
  | 'agent_task_context';

export interface BenchmarkMemoryRecord {
  id: string;
  content: string;
  type: BenchmarkMemoryType;
  timestamp: string;
  tags: string[];
  importance?: number;
  metadata?: Record<string, unknown>;
  associations?: Array<{
    targetId: string;
    strength: number;
  }>;
}

export interface BenchmarkRecallRequest {
  query?: string;
  limit?: number;
  minScore?: number;
  maxHops?: number;
  blendWeight?: number;
  activationThreshold?: number;
}

export type BenchmarkOperation =
  | {
      kind: 'recall_probe';
      label: string;
      query: string;
      repeat?: number;
      options?: BenchmarkRecallRequest;
    }
  | {
      kind: 'forget';
      memoryId: string;
    }
  | {
      kind: 'decay';
      cycles: number;
      decayRate: number;
      minScore: number;
    }
  | {
      kind: 'export_import';
      targetAgentId: string;
    };

export interface BenchmarkExpectation {
  requiredMemoryIds: string[];
  forbiddenMemoryIds: string[];
  shouldAbstain?: boolean;
  preferredOver?: Array<{
    preferredId: string;
    competingIds: string[];
  }>;
  probeComparisons?: Array<{
    labelBefore: string;
    labelAfter: string;
    memoryId: string;
  }>;
  preserveAfterImportIds?: string[];
}

export interface BenchmarkCase {
  scenarioId: string;
  scenarioType: BenchmarkScenarioType;
  title: string;
  description: string;
  agentId: string;
  memories: BenchmarkMemoryRecord[];
  operations: BenchmarkOperation[];
  question: string;
  expectedAnswer: string;
  recallOptions: BenchmarkRecallRequest;
  expectations: BenchmarkExpectation;
}

export interface BenchmarkDataset {
  name: string;
  generatedAt: string;
  cases: BenchmarkCase[];
}

export interface BenchmarkRecallResult {
  memoryId: string;
  content: string;
  score: number;
  type?: BenchmarkMemoryType;
  source?: string;
  rankingTrace?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProviderCapabilities {
  associations: boolean;
  forget: boolean;
  decay: boolean;
  portability: boolean;
}

export interface ProviderAvailability {
  status: 'available' | 'unsupported';
  reason?: string;
}

export interface ProviderStats {
  storageSizeBytes: number | null;
}

export interface MemoryProviderAdapter {
  readonly name: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  availability(): Promise<ProviderAvailability>;
  reset(agentId: string): Promise<void>;
  remember(memory: BenchmarkMemoryRecord, agentId: string): Promise<void>;
  associate?(sourceId: string, targetId: string, strength: number, agentId: string): Promise<void>;
  recall(
    request: BenchmarkRecallRequest & {
      agentId: string;
    },
  ): Promise<BenchmarkRecallResult[]>;
  forget?(memoryId: string, agentId: string): Promise<void>;
  applyDecay?(decayRate: number, minScore: number): Promise<number>;
  exportMemory?(agentId: string): Promise<unknown>;
  importMemory?(payload: unknown, agentId: string): Promise<void>;
  getStats?(): Promise<ProviderStats>;
  close(): Promise<void>;
}

export class BenchmarkSkipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkSkipError';
  }
}

export function isBenchmarkSkipError(error: unknown): error is BenchmarkSkipError {
  return error instanceof BenchmarkSkipError;
}
