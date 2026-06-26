import type {
  CreateAssociationInput,
  CreateMemoryInput,
  Memory,
  SearchMemoryInput,
  SearchResult,
} from '@1mbrain/core';

export interface OneMBrainClientConfig {
  apiUrl: string;
  apiKey: string;
  agentId?: string;
  fetch?: typeof fetch;
}

export type RememberInput = Omit<CreateMemoryInput, 'agentId'> & {
  agentId?: string;
};

export type RecallInput = Omit<SearchMemoryInput, 'agentId'> & {
  agentId?: string;
};

export type AssociateInput = Omit<CreateAssociationInput, 'sourceId' | 'agentId'> & {
  agentId?: string;
};

export interface IngestUrlOptions {
  agentId?: string;
  confidenceThreshold?: number;
  maxChunkChars?: number;
  deduplicate?: boolean;
}

export interface IngestMarkdownOptions extends IngestUrlOptions {
  title: string;
  /** Stable URL or URN identifying this document. */
  url: string;
  markdown: string;
}

export interface IngestResult {
  title: string;
  url: string;
  sourceHash: string;
  chunkCount: number;
  extractedCount: number;
  storedCount: number;
  skippedCount: number;
  errorCount: number;
  deduplicated: boolean;
  memoryIds: string[];
}

export interface ConsolidateOptions {
  agentId?: string;
  dryRun?: boolean;
  clusterStrategy?: 'tags' | 'graph' | 'hybrid';
}

export interface ConsolidationResult {
  agentId: string;
  triggerReason: 'sleep-cycle' | 'threshold';
  dryRun: boolean;
  storedCount: number;
  archivedCount: number;
  clustersProcessed: number;
  skipped: {
    noCandidates: number;
    tooSmallClusters: number;
    summarizationFailed: number;
    dryRun: number;
  };
  errors: string[];
  summaryIds: string[];
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
  message?: string;
}

export class OneMBrainError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OneMBrainError';
  }
}

export class OneMBrainClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly agentId?: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: OneMBrainClientConfig) {
    if (!config.apiUrl) {
      throw new Error('apiUrl is required');
    }

    if (!config.apiKey) {
      throw new Error('apiKey is required');
    }

    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.fetchFn = config.fetch ?? fetch;
  }

  async remember(input: RememberInput): Promise<Memory> {
    const agentId = this.resolveAgentId(input.agentId);
    const envelope = await this.request<ApiEnvelope<SerializedMemory>>('/v1/memories', {
      method: 'POST',
      agentId,
      body: {
        ...input,
        agentId,
      },
    });

    return deserializeMemory(envelope.data);
  }

  async recall(input: RecallInput): Promise<SearchResult[]> {
    const agentId = this.resolveAgentId(input.agentId);
    const params = toSearchParams({
      ...input,
      agentId,
      q: input.query,
      query: undefined,
    });
    const envelope = await this.request<ApiEnvelope<SerializedSearchResult[]>>(
      `/v1/memories/search?${params.toString()}`,
      {
        method: 'GET',
        agentId,
      },
    );

    const results = envelope.data.map((result) => ({
      ...result,
      memory: deserializeMemory(result.memory),
    })) as SearchResult[] & { confidence?: string; reason?: string };

    if (envelope.meta) {
      results.confidence = envelope.meta.confidence as string | undefined;
      results.reason = envelope.meta.reason as string | undefined;
    }

    return results;
  }

  async forget(id: string, options: { agentId?: string } = {}): Promise<boolean> {
    const envelope = await this.request<ApiEnvelope<unknown>>(`/v1/memories/${id}`, {
      method: 'DELETE',
      agentId: this.resolveAgentId(options.agentId),
    });

    return envelope.success;
  }

  async associate(sourceId: string, input: AssociateInput): Promise<boolean> {
    const envelope = await this.request<ApiEnvelope<unknown>>(
      `/v1/memories/${sourceId}/associate`,
      {
        method: 'POST',
        agentId: this.resolveAgentId(input.agentId),
        body: {
          targetId: input.targetId,
          strength: input.strength,
          origin: input.origin,
          relationType: input.relationType,
        },
      },
    );

    return envelope.success;
  }

  /**
   * Ingest a web page URL into memory.
   *
   * The server-side pipeline will:
   * 1. Fetch the page HTML
   * 2. Extract main content → Markdown
   * 3. Chunk and extract factual claims via LLM
   * 4. Store facts as memories (type, importance, metadata auto-set)
   *
   * Works from any gateway: Telegram, Discord, browser extension, CLI.
   *
   * @param url - The URL to ingest
   * @param options - Optional overrides (agentId, confidenceThreshold, etc.)
   */
  async ingestUrl(url: string, options: IngestUrlOptions = {}): Promise<IngestResult> {
    const agentId = this.resolveAgentId(options.agentId);
    const envelope = await this.request<ApiEnvelope<IngestResult>>('/v1/ingest/url', {
      method: 'POST',
      agentId,
      body: {
        url,
        agentId,
        confidenceThreshold: options.confidenceThreshold,
        maxChunkChars: options.maxChunkChars,
        deduplicate: options.deduplicate,
      },
    });

    return envelope.data;
  }

  /** Ingest trusted, already-clean Markdown without fetching a URL. */
  async ingestMarkdown(options: IngestMarkdownOptions): Promise<IngestResult> {
    const agentId = this.resolveAgentId(options.agentId);
    const envelope = await this.request<ApiEnvelope<IngestResult>>('/v1/ingest/markdown', {
      method: 'POST',
      agentId,
      body: {
        title: options.title,
        url: options.url,
        markdown: options.markdown,
        agentId,
        confidenceThreshold: options.confidenceThreshold,
        maxChunkChars: options.maxChunkChars,
        deduplicate: options.deduplicate,
      },
    });

    return envelope.data;
  }

  async consolidate(options: ConsolidateOptions = {}): Promise<ConsolidationResult> {
    const agentId = this.resolveAgentId(options.agentId);
    const envelope = await this.request<ApiEnvelope<ConsolidationResult>>('/v1/consolidate', {
      method: 'POST',
      agentId,
      body: {
        agentId,
        dryRun: options.dryRun,
        clusterStrategy: options.clusterStrategy,
      },
    });

    return envelope.data;
  }

  private resolveAgentId(agentId?: string): string {
    const resolved = agentId ?? this.agentId;

    if (resolved === undefined || resolved === null) {
      throw new Error('agentId is required');
    }

    return resolved;
  }

  private async request<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'DELETE';
      agentId: string;
      body?: unknown;
    },
  ): Promise<T> {
    const response = await this.fetchFn(`${this.apiUrl}${path}`, {
      method: options.method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'x-agent-id': options.agentId,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const payload = await readJson(response);

    if (!response.ok) {
      throw new OneMBrainError(
        extractErrorMessage(payload, response.statusText),
        response.status,
        payload,
      );
    }

    return payload as T;
  }
}

type SerializedMemory = Omit<Memory, 'createdAt' | 'lastAccessedAt'> & {
  createdAt: string;
  lastAccessedAt: string;
};

type SerializedSearchResult = Omit<SearchResult, 'memory'> & {
  memory: SerializedMemory;
};

function deserializeMemory(memory: SerializedMemory): Memory {
  return {
    ...memory,
    createdAt: new Date(memory.createdAt),
    lastAccessedAt: new Date(memory.lastAccessedAt),
  };
}

function toSearchParams(input: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      params.set(key, value.join(','));
      continue;
    }

    params.set(key, String(value));
  }

  return params;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    return String((payload as { error: unknown }).error);
  }

  if (payload && typeof payload === 'object' && 'message' in payload) {
    return String((payload as { message: unknown }).message);
  }

  return fallback || '1MBrain request failed';
}

export type { Memory, SearchResult };
export { AGENT_SYSTEM_PROMPT } from './prompts.js';
