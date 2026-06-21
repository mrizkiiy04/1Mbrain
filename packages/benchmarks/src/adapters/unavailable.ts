import type {
  BenchmarkMemoryRecord,
  BenchmarkRecallRequest,
  BenchmarkRecallResult,
  MemoryProviderAdapter,
  ProviderAvailability,
} from '../provider.js';

export class UnavailableAdapter implements MemoryProviderAdapter {
  readonly capabilities = {
    associations: false,
    forget: false,
    decay: false,
    portability: false,
  } as const;

  constructor(
    readonly name: string,
    readonly label: string,
    private readonly reason: string,
  ) {}

  async availability(): Promise<ProviderAvailability> {
    return {
      status: 'unsupported',
      reason: this.reason,
    };
  }

  async reset(_agentId: string): Promise<void> {
    throw new Error(this.reason);
  }

  async remember(_memory: BenchmarkMemoryRecord, _agentId: string): Promise<void> {
    throw new Error(this.reason);
  }

  async recall(
    _request: BenchmarkRecallRequest & {
      agentId: string;
    },
  ): Promise<BenchmarkRecallResult[]> {
    throw new Error(this.reason);
  }

  async close(): Promise<void> {
    // No-op.
  }
}
