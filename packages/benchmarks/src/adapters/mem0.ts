import { MemoryClient } from 'mem0ai';
import type {
  BenchmarkMemoryRecord,
  BenchmarkRecallRequest,
  BenchmarkRecallResult,
  MemoryProviderAdapter,
  ProviderAvailability,
} from '../provider.js';

export class Mem0BenchmarkAdapter implements MemoryProviderAdapter {
  readonly name = 'mem0';
  readonly label = 'Mem0 (Cloud)';
  readonly capabilities = {
    associations: false,
    forget: true,
    decay: false,
    portability: false,
  } as const;

  private client: MemoryClient | null = null;
  private readonly apiKey: string;
  private readonly idMap = new Map<string, string>(); // benchId -> mem0Id
  private readonly reverseIdMap = new Map<string, string>(); // mem0Id -> benchId

  constructor() {
    this.apiKey = process.env.MEM0_API_KEY ?? '';
  }

  async availability(): Promise<ProviderAvailability> {
    if (!this.apiKey) {
      return {
        status: 'unsupported',
        reason: 'MEM0_API_KEY is not set.',
      };
    }

    try {
      // Basic initialization check
      const testClient = new MemoryClient({ apiKey: this.apiKey });
      if (!testClient) {
        throw new Error('Failed to instantiate MemoryClient');
      }
      return { status: 'available' };
    } catch (error) {
      return {
        status: 'unsupported',
        reason: `Mem0 is not initialized: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async reset(agentId: string): Promise<void> {
    this.client = new MemoryClient({ apiKey: this.apiKey });
    this.idMap.clear();
    this.reverseIdMap.clear();
    try {
      await this.client.deleteUsers({ userId: agentId });
    } catch {
      // Ignore if user does not exist or API fails on empty reset
    }
  }

  async remember(memory: BenchmarkMemoryRecord, agentId: string): Promise<void> {
    if (!this.client) {
      throw new Error(`${this.label} is not initialized`);
    }

    const response = await (this.client as any).add(
      [{ role: 'user', content: memory.content }],
      { user_id: agentId, userId: agentId, infer: false }
    );

    const mem0Id = response?.results?.[0]?.id;
    if (mem0Id) {
      this.idMap.set(memory.id, mem0Id);
      this.reverseIdMap.set(mem0Id, memory.id);
    }
  }

  async recall(
    request: BenchmarkRecallRequest & {
      agentId: string;
    },
  ): Promise<BenchmarkRecallResult[]> {
    if (!this.client) {
      throw new Error(`${this.label} is not initialized`);
    }

    const results = await (this.client as any).search(request.query ?? '', {
      filters: {
        user_id: request.agentId,
      },
      limit: request.limit ?? 5,
    });

    const rawResults = Array.isArray(results) ? results : (results as any)?.results ?? [];

    return rawResults.map((result: any, index: number) => {
      const mem0Id = result.id;
      const benchId = mem0Id ? this.reverseIdMap.get(mem0Id) : undefined;
      return {
        memoryId: benchId ?? result.id ?? `mem0-${index}`,
        content: result.memory ?? result.content ?? '',
        score: result.score ?? 1.0,
        source: 'vector',
      };
    });
  }

  async forget(memoryId: string, _agentId: string): Promise<void> {
    if (!this.client) {
      throw new Error(`${this.label} is not initialized`);
    }

    const mappedId = this.idMap.get(memoryId) || memoryId;
    await this.client.delete(mappedId);
  }

  async close(): Promise<void> {
    this.client = null;
    this.idMap.clear();
    this.reverseIdMap.clear();
  }
}
