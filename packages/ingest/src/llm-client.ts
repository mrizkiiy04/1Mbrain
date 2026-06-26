/**
 * LLM Client
 *
 * A unified chat completion client with dedicated extraction configuration.
 * It falls back to embedding configuration for backwards compatibility.
 *
 * Provider selection:
 * - If EMBEDDING_PROVIDER=openai → uses OpenAI Chat API (same API key)
 * - If EMBEDDING_PROVIDER=ollama → uses Ollama Chat API (same base URL)
 *
 * Model selection:
 * - INGEST_FACT_EXTRACTION_MODEL env var (optional)
 * - Default for OpenAI: "gpt-4o-mini"
 * - Default for Ollama: "llama3.2"
 *
 * No new credentials needed — fully inherited from existing config.
 */

import type { LLMClientConfig, LLMMessage, LLMChatResult, LLMProviderType } from './types.js';

const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  openai: 'gpt-4o-mini',
  ollama: 'llama3.2',
};

const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Config Builder ───────────────────────────────────────

/**
 * Build LLM client config from environment variables.
 * Inherits provider and credentials from the embedding config.
 */
export function buildLLMConfigFromEnv(): LLMClientConfig {
  const provider = (process.env['INGEST_FACT_EXTRACTION_PROVIDER'] ?? process.env['EMBEDDING_PROVIDER'] ?? 'ollama') as LLMProviderType;
  if (provider !== 'openai' && provider !== 'ollama') {
    throw new Error(`Unsupported INGEST_FACT_EXTRACTION_PROVIDER: ${provider}`);
  }

  const model = process.env['INGEST_FACT_EXTRACTION_MODEL'] ?? DEFAULT_MODELS[provider];

  if (provider === 'openai') {
    const apiKey = process.env['INGEST_FACT_EXTRACTION_API_KEY'] ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('INGEST_FACT_EXTRACTION_API_KEY or OPENAI_API_KEY is required for OpenAI fact extraction');
    }
    return {
      provider: 'openai',
      model,
      apiKey,
      baseUrl: process.env['INGEST_FACT_EXTRACTION_BASE_URL'] ?? process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com',
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }

  return {
    provider: 'ollama',
    model,
    baseUrl: process.env['INGEST_FACT_EXTRACTION_BASE_URL'] ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

// ─── LLM Client ───────────────────────────────────────────

export class LLMClient {
  constructor(private readonly config: LLMClientConfig) {}

  /**
   * Send a chat completion request and return the response text.
   */
  async chat(messages: LLMMessage[], jsonMode = false): Promise<LLMChatResult> {
    if (this.config.provider === 'openai') {
      return this.chatOpenAI(messages, jsonMode);
    }
    return this.chatOllama(messages, jsonMode);
  }

  // ─── OpenAI ──────────────────────────────────────────

  private async chatOpenAI(messages: LLMMessage[], jsonMode: boolean): Promise<LLMChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages,
        temperature: 0.1, // Low temp for fact extraction
        max_tokens: 2048,
      };

      if (jsonMode) {
        body['response_format'] = { type: 'json_object' };
      }

      const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${err}`);
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string };
          finish_reason: string;
        }>;
      };

      const choice = data.choices[0];
      return {
        content: choice?.message?.content ?? '',
        finishReason: choice?.finish_reason ?? 'unknown',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Ollama ──────────────────────────────────────────

  private async chatOllama(messages: LLMMessage[], jsonMode: boolean): Promise<LLMChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 2048,
        },
      };

      if (jsonMode) {
        body['format'] = 'json';
      }

      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${err}`);
      }

      const data = (await response.json()) as {
        message: { content: string };
        done_reason?: string;
      };

      return {
        content: data.message?.content ?? '',
        finishReason: data.done_reason ?? 'stop',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Singleton factory ────────────────────────────────────

let _defaultClient: LLMClient | null = null;

/**
 * Get or create the default LLM client using environment config.
 * Creates a singleton on first call.
 */
export function getDefaultLLMClient(): LLMClient {
  if (!_defaultClient) {
    _defaultClient = new LLMClient(buildLLMConfigFromEnv());
  }
  return _defaultClient;
}

/**
 * Override the default LLM client (useful for testing).
 */
export function setDefaultLLMClient(client: LLMClient): void {
  _defaultClient = client;
}
