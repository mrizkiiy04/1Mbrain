import type {
  BenchmarkMemoryRecord,
  BenchmarkRecallRequest,
  BenchmarkRecallResult,
  MemoryProviderAdapter,
  ProviderAvailability,
} from '../provider.js';
import { KeywordEmbeddingProvider } from './keyword-embedding.js';

type QdrantPoint = {
  id: number;
  vector: number[];
  payload: {
    benchId: string;
    agentId: string;
    type: string;
    tags: string[];
    content: string;
    importance: number;
    metadata?: Record<string, unknown>;
  };
};

type QdrantSearchResult = {
  id: number;
  score: number;
  payload?: {
    benchId?: string;
    content?: string;
    type?: string;
    metadata?: Record<string, unknown>;
  };
};

export class QdrantBenchmarkAdapter implements MemoryProviderAdapter {
  readonly name = 'qdrant_vector';
  readonly label = 'Qdrant Vector';
  readonly capabilities = {
    associations: false,
    forget: true,
    decay: false,
    portability: false,
  } as const;

  private readonly embedder = new KeywordEmbeddingProvider();
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly collectionName: string;
  private pointCounter = 0;
  private readonly idMap = new Map<string, number>();

  constructor(options: { url?: string; apiKey?: string; collectionName?: string } = {}) {
    this.baseUrl = (options.url ?? process.env.QDRANT_URL ?? '').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env.QDRANT_API_KEY;
    this.collectionName =
      options.collectionName ?? process.env.QDRANT_COLLECTION ?? 'one_million_brain_bench_v2';
  }

  async availability(): Promise<ProviderAvailability> {
    if (!this.baseUrl) {
      return {
        status: 'unsupported',
        reason: 'QDRANT_URL is not set.',
      };
    }

    try {
      await this.request('/collections', { method: 'GET' });
      return { status: 'available' };
    } catch (error) {
      return {
        status: 'unsupported',
        reason: `Qdrant is not reachable at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async reset(_agentId: string): Promise<void> {
    await this.request(`/collections/${encodeURIComponent(this.collectionName)}`, {
      method: 'DELETE',
      allowNotFound: true,
    });
    await this.request(`/collections/${encodeURIComponent(this.collectionName)}`, {
      method: 'PUT',
      body: {
        vectors: {
          size: this.embedder.dimensions,
          distance: 'Cosine',
        },
      },
    });

    this.pointCounter = 0;
    this.idMap.clear();
  }

  async remember(memory: BenchmarkMemoryRecord, agentId: string): Promise<void> {
    this.pointCounter += 1;
    this.idMap.set(memory.id, this.pointCounter);

    const point: QdrantPoint = {
      id: this.pointCounter,
      vector: await this.embedder.embed(memory.content),
      payload: {
        benchId: memory.id,
        agentId,
        type: memory.type,
        tags: memory.tags,
        content: memory.content,
        importance: memory.importance ?? 0.75,
        metadata: {
          ...(memory.metadata ?? {}),
          benchId: memory.id,
          benchTimestamp: memory.timestamp,
        },
      },
    };

    await this.request(`/collections/${encodeURIComponent(this.collectionName)}/points?wait=true`, {
      method: 'PUT',
      body: {
        points: [point],
      },
    });
  }

  async recall(
    request: BenchmarkRecallRequest & {
      agentId: string;
    },
  ): Promise<BenchmarkRecallResult[]> {
    const response = (await this.request(
      `/collections/${encodeURIComponent(this.collectionName)}/points/search`,
      {
        method: 'POST',
        body: {
          vector: await this.embedder.embed(request.query ?? ''),
          limit: request.limit ?? 5,
          score_threshold: request.minScore ?? 0.08,
          with_payload: true,
          filter: {
            must: [
              {
                key: 'agentId',
                match: { value: request.agentId },
              },
            ],
          },
        },
      },
    )) as { result: QdrantSearchResult[] };

    return response.result.map((result) => ({
      memoryId: result.payload?.benchId ?? String(result.id),
      content: result.payload?.content ?? '',
      score: result.score,
      type: result.payload?.type as BenchmarkMemoryRecord['type'] | undefined,
      source: 'vector',
      metadata: result.payload?.metadata,
    }));
  }

  async forget(memoryId: string, _agentId: string): Promise<void> {
    const pointId = this.idMap.get(memoryId);
    if (!pointId) return;

    await this.request(`/collections/${encodeURIComponent(this.collectionName)}/points/delete?wait=true`, {
      method: 'POST',
      body: {
        points: [pointId],
      },
    });
  }

  async close(): Promise<void> {
    if (!this.baseUrl) return;
    await this.request(`/collections/${encodeURIComponent(this.collectionName)}`, {
      method: 'DELETE',
      allowNotFound: true,
    }).catch(() => undefined);
    this.idMap.clear();
    this.pointCounter = 0;
  }

  private async request(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      allowNotFound?: boolean;
    },
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { 'api-key': this.apiKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (options.allowNotFound && response.status === 404) {
      return {};
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Qdrant ${response.status}: ${text}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}
