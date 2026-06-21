import type { BenchmarkCase, BenchmarkRecallResult } from './provider.js';
import type { CaseEvaluation } from './metrics.js';

export interface LlmCaseEvaluation {
  model: string;
  generatedAnswer: string;
  score0To5: number;
  hallucination: boolean;
  rationale: string;
}

type DeepSeekChatResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
};

type DeepSeekEvalPayload = {
  generated_answer?: string;
  score_0_to_5?: number;
  hallucination?: boolean;
  rationale?: string;
};

export function getLlmEvaluatorType(): 'deepseek' | 'openai' | null {
  const envValue = (process.env['BENCH_LLM_EVAL'] ?? '').toLowerCase();
  if (envValue === 'deepseek') return 'deepseek';
  if (envValue === 'openai') return 'openai';
  return null;
}

export function shouldUseLlmEvaluation(): boolean {
  return getLlmEvaluatorType() !== null;
}

export async function evaluateWithDeepSeek(
  benchmarkCase: BenchmarkCase,
  recallResults: BenchmarkRecallResult[],
): Promise<LlmCaseEvaluation> {
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is required when BENCH_LLM_EVAL=deepseek');
  }

  const model = process.env['BENCH_LLM_MODEL'] ?? 'deepseek-v4-flash';
  const baseUrl =
    process.env['DEEPSEEK_BASE_URL'] ??
    process.env['DEEPSEEK_API_BASE'] ??
    'https://api.deepseek.com';

  try {
    return await requestDeepSeekEvaluation({
      apiKey,
      baseUrl,
      model,
      benchmarkCase,
      recallResults,
      jsonMode: true,
    });
  } catch (error) {
    const retry = await requestDeepSeekEvaluation({
      apiKey,
      baseUrl,
      model,
      benchmarkCase,
      recallResults,
      jsonMode: false,
    });
    retry.rationale = `${retry.rationale} (retry_after_json_mode_error=${error instanceof Error ? error.message : String(error)})`;
    return retry;
  }
}

export async function evaluateWithOpenAI(
  benchmarkCase: BenchmarkCase,
  recallResults: BenchmarkRecallResult[],
): Promise<LlmCaseEvaluation> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required when BENCH_LLM_EVAL=openai');
  }

  const model = process.env['BENCH_LLM_MODEL'] ?? 'gpt-4o-mini';
  const baseUrl = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: Number(process.env['BENCH_LLM_MAX_TOKENS'] ?? 1500),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a strict memory benchmark evaluator. Use only the provided retrieved memories. Return valid JSON only.',
        },
        {
          role: 'user',
          content: buildPrompt(benchmarkCase, recallResults),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenAI response did not include message content: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const payload = parseJsonObject(content);
  return {
    model,
    generatedAnswer: String(payload.generated_answer ?? ''),
    score0To5: clampScore(payload.score_0_to_5),
    hallucination: Boolean(payload.hallucination),
    rationale: String(payload.rationale ?? ''),
  };
}

async function requestDeepSeekEvaluation(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  benchmarkCase: BenchmarkCase;
  recallResults: BenchmarkRecallResult[];
  jsonMode: boolean;
}): Promise<LlmCaseEvaluation> {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0,
      max_tokens: Number(process.env['BENCH_LLM_MAX_TOKENS'] ?? 1500),
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        {
          role: 'system',
          content:
            'You are a strict memory benchmark evaluator. Use only the provided retrieved memories. Return valid JSON only.',
        },
        {
          role: 'user',
          content: buildPrompt(options.benchmarkCase, options.recallResults),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek ${response.status}: ${text}`);
  }

  const data = (await response.json()) as DeepSeekChatResponse;
  const message = data.choices?.[0]?.message;
  const content = message?.content?.trim()
    ? message.content
    : message?.reasoning_content?.trim()
      ? message.reasoning_content
      : undefined;
  if (!content) {
    throw new Error(`DeepSeek response did not include message content: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const payload = parseJsonObject(content);
  return {
    model: options.model,
    generatedAnswer: String(payload.generated_answer ?? ''),
    score0To5: clampScore(payload.score_0_to_5),
    hallucination: Boolean(payload.hallucination),
    rationale: String(payload.rationale ?? ''),
  };
}

export function applyLlmEvaluation(
  evaluation: CaseEvaluation,
  llmEvaluation: LlmCaseEvaluation,
): void {
  evaluation.answerAccuracy = llmEvaluation.score0To5;
  evaluation.hallucinationRate = llmEvaluation.hallucination ? 1 : 0;
  evaluation.notes.push(`llm_evaluator=${llmEvaluation.model}`);
  if (llmEvaluation.score0To5 < 4) {
    evaluation.failureTags.push('llm_answer_incorrect');
  }
  if (llmEvaluation.hallucination) {
    evaluation.failureTags.push('llm_hallucination');
  }
  evaluation.failureTags = Array.from(new Set(evaluation.failureTags));
}

function buildPrompt(
  benchmarkCase: BenchmarkCase,
  recallResults: BenchmarkRecallResult[],
): string {
  const memories = recallResults
    .slice(0, benchmarkCase.recallOptions.limit ?? 10)
    .map((result, index) => {
      return [
        `Memory ${index + 1}`,
        `id: ${result.memoryId}`,
        `score: ${result.score}`,
        `content: ${result.content}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    `Question: ${benchmarkCase.question}`,
    `Expected answer: ${benchmarkCase.expectedAnswer}`,
    `Required memory ids: ${benchmarkCase.expectations.requiredMemoryIds.join(', ') || '(none)'}`,
    `Forbidden memory ids: ${benchmarkCase.expectations.forbiddenMemoryIds.join(', ') || '(none)'}`,
    '',
    'Retrieved memories:',
    memories || '(none)',
    '',
    'Task:',
    '1. Generate a concise answer to the question using only the retrieved memories.',
    '2. Score the generated answer from 0 to 5 against the expected answer.',
    '3. Set hallucination=true if the answer uses unsupported facts or relies on forbidden/stale memory.',
    '',
    'Return JSON with exactly these keys: generated_answer, score_0_to_5, hallucination, rationale.',
  ].join('\n');
}

function parseJsonObject(content: string): DeepSeekEvalPayload {
  try {
    return JSON.parse(content) as DeepSeekEvalPayload;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`DeepSeek response was not JSON: ${content.slice(0, 200)}`);
    }
    return JSON.parse(match[0]) as DeepSeekEvalPayload;
  }
}

function clampScore(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Math.max(0, Math.min(5, numberValue));
}
