/**
 * Adapters that normalize eval result formats into UnifiedEvalResult.
 *
 * Each adapter reads the raw JSON (eval results + optionally predict results)
 * and produces the unified schema. The key job of each adapter is to PRESERVE
 * retrieved memories and per-step data that the original eval pipeline may
 * have discarded.
 */

import type {
  UnifiedEvalResult,
  EvalMetadata,
  EvalMetrics,
  MetricBucket,
  EvalItem,
  RetrievalData,
  JudgmentData,
  KeyFact,
  IngestionData,
  GenerationData,
  ScoreDebug,
  QueryDebug,
} from "./schema";

// --- Detection ---

export function detectFormat(
  data: Record<string, unknown>,
): "locomo" | "longmemeval" | "beam" | "unknown" {
  // Check metadata.eval_type first (BEAM sets this explicitly)
  const meta = data.metadata as Record<string, unknown> | undefined;
  if (meta?.eval_type === "beam") return "beam";

  const metrics = data.metrics_by_cutoff as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (metrics) {
    const first = Object.values(metrics)[0];
    if (first && "by_category" in first) return "locomo";
    if (first && "by_question_type" in first) return "longmemeval";
  }
  return "unknown";
}

export function normalize(
  evalData: Record<string, unknown>,
  predictData?: Record<string, unknown>,
): UnifiedEvalResult {
  const format = detectFormat(evalData);
  switch (format) {
    case "locomo":
      return normalizeLocomo(evalData, predictData);
    case "longmemeval":
      return normalizeLongMemEval(evalData, predictData);
    case "beam":
      return normalizeBeam(evalData, predictData);
    default:
      return normalizeFallback(evalData);
  }
}

// --- LOCOMO Adapter ---

function normalizeLocomo(
  evalData: Record<string, unknown>,
  predictData?: Record<string, unknown>,
): UnifiedEvalResult {
  const meta = evalData.metadata as Record<string, unknown>;
  const metricsByCutoff = evalData.metrics_by_cutoff as Record<
    string,
    Record<string, unknown>
  >;
  const rawEvals = evalData.evaluations as Record<string, unknown>[];

  // Build predict lookup: question_id -> predict data (with retrieved memories)
  const predictLookup = new Map<string, Record<string, unknown>>();
  if (predictData) {
    const questions = (predictData.questions ??
      predictData.evaluations ??
      []) as Record<string, unknown>[];
    for (const q of questions) {
      predictLookup.set(q.question_id as string, q);
    }
  }

  const cutoffs = Object.keys(metricsByCutoff);
  const primaryCutoff = cutoffs[cutoffs.length - 1];
  const primaryMetrics = metricsByCutoff[primaryCutoff] as Record<
    string,
    unknown
  >;
  const overall = primaryMetrics.overall as Record<string, number>;
  const byCategory = primaryMetrics.by_category as Record<
    string,
    Record<string, number>
  >;

  const metadata: EvalMetadata = {
    eval_type: "locomo",
    project_name: (meta.project_name as string) ?? "unknown",
    timestamp: parseTimestamp(meta.timestamp as string),
    models: {
      answerer: meta.answerer_model as string,
      judge: meta.judge_model as string,
    },
    dataset: {
      name: "locomo10",
      total_items: meta.total_questions as number,
      top_k_cutoffs: meta.top_k_cutoffs as string[],
      categories: meta.categories as number[],
    },
  };

  // Compute avg latencies from raw evaluations
  const searchLatencies = rawEvals
    .map((e) => e.search_latency_ms as number | undefined)
    .filter((v): v is number => v != null && v > 0);
  const addLatencies = rawEvals
    .map((e) => e.add_latency_total_ms as number | undefined)
    .filter((v): v is number => v != null && v > 0);
  const avgSearchLatency =
    searchLatencies.length > 0
      ? searchLatencies.reduce((a, b) => a + b, 0) / searchLatencies.length
      : undefined;
  const avgAddLatency =
    addLatencies.length > 0
      ? addLatencies.reduce((a, b) => a + b, 0) / addLatencies.length
      : undefined;

  // Build metrics
  const metrics: EvalMetrics = {
    overall: {
      total: overall.total,
      passed: overall.correct ?? 0,
      failed: overall.total - (overall.correct ?? 0),
      errors: overall.errors ?? 0,
      accuracy: overall.accuracy ?? 0,
      avg_score: overall.avg_score,
      avg_search_latency_ms: avgSearchLatency,
      avg_add_latency_ms: avgAddLatency,
    },
    by_group: {},
  };

  for (const [name, cat] of Object.entries(byCategory)) {
    const groupEvals = rawEvals.filter((e) => e.category_name === name);
    const groupSearchLats = groupEvals
      .map((e) => e.search_latency_ms as number | undefined)
      .filter((v): v is number => v != null && v > 0);
    const groupAddLats = groupEvals
      .map((e) => e.add_latency_total_ms as number | undefined)
      .filter((v): v is number => v != null && v > 0);

    metrics.by_group![name] = {
      total: cat.total,
      passed: cat.correct ?? 0,
      failed: cat.total - (cat.correct ?? 0),
      errors: 0,
      accuracy: cat.accuracy ?? 0,
      avg_score: cat.avg_score,
      avg_search_latency_ms:
        groupSearchLats.length > 0
          ? groupSearchLats.reduce((a, b) => a + b, 0) / groupSearchLats.length
          : undefined,
      avg_add_latency_ms:
        groupAddLats.length > 0
          ? groupAddLats.reduce((a, b) => a + b, 0) / groupAddLats.length
          : undefined,
    };
  }

  // Multi-cutoff
  if (cutoffs.length > 1) {
    metrics.by_cutoff = {};
    for (const cutoff of cutoffs) {
      const cm = metricsByCutoff[cutoff] as Record<string, unknown>;
      const co = cm.overall as Record<string, number>;
      const cc = cm.by_category as Record<string, Record<string, number>>;
      metrics.by_cutoff[cutoff] = {
        overall: {
          total: co.total,
          passed: co.correct ?? 0,
          failed: co.total - (co.correct ?? 0),
          errors: co.errors ?? 0,
          accuracy: co.accuracy ?? 0,
          avg_score: co.avg_score,
        },
        by_group: {},
      };
      for (const [name, cat] of Object.entries(cc)) {
        metrics.by_cutoff[cutoff].by_group![name] = {
          total: cat.total,
          passed: cat.correct ?? 0,
          failed: cat.total - (cat.correct ?? 0),
          errors: 0,
          accuracy: cat.accuracy ?? 0,
          avg_score: cat.avg_score,
        };
      }
    }
  }

  // Conversation labels for locomo (hardcoded from dataset)
  const LOCOMO_CONVERSATIONS: Record<number, string> = {
    0: "Caroline & Melanie",
    1: "Jon & Gina",
    2: "John & Maria",
    3: "Joanna & Nate",
    4: "Tim & John",
    5: "Audrey & Andrew",
    6: "James & John",
    7: "Deborah & Jolene",
    8: "Evan & Sam",
    9: "Calvin & Dave",
  };

  // Build evaluations
  const evaluations: EvalItem[] = rawEvals.map((ev) => {
    const cutoffResults = ev.cutoff_results as Record<
      string,
      Record<string, unknown>
    >;
    const primaryResult = cutoffResults?.[primaryCutoff];
    const predict = predictLookup.get(ev.question_id as string);

    // Build retrieval from predict data if available
    let retrieval: RetrievalData | undefined;
    if (predict) {
      const ret = predict.retrieval as Record<string, unknown> | undefined;
      if (ret) {
        const searchResults = (ret.search_results ?? []) as Record<
          string,
          unknown
        >[];
        retrieval = {
          query: (ret.search_query as string) ?? (ev.question as string),
          latency_ms: ret.search_latency_ms as number | undefined,
          total_results:
            (ret.total_results as number) ?? searchResults.length,
          results: searchResults.map((sr, i) => ({
            rank: i + 1,
            memory: sr.memory as string,
            score: sr.score as number,
            id: sr.id as string | undefined,
            created_at: sr.created_at as string | undefined,
            score_debug: sr.score_debug as ScoreDebug | undefined,
          })),
          query_debug: ret.query_debug as QueryDebug | undefined,
        };
      }
    }

    // Build judgment
    let judgment: JudgmentData | undefined;
    if (primaryResult) {
      const verdict = (primaryResult.judgment as string)?.toLowerCase();
      judgment = {
        model: meta.judge_model as string,
        verdict:
          verdict === "correct"
            ? "correct"
            : verdict === "error"
              ? "error"
              : "incorrect",
        score:
          (primaryResult.score as number) ??
          (verdict === "correct" ? 1.0 : 0.0),
        reasoning: primaryResult.reason as string | undefined,
      };
    }

    // Build generation
    let generation: GenerationData | undefined;
    if (primaryResult?.generated_answer) {
      generation = {
        model: (meta.answerer_model as string) ?? "unknown",
        answer: primaryResult.generated_answer as string,
      };
    }

    const convIdx = ev.conversation_idx as number;
    return {
      id: ev.question_id as string,
      group: (ev.category_name as string) ?? `category_${ev.category}`,
      question: ev.question as string,
      ground_truth: ev.ground_truth_answer as string,
      conversation_idx: convIdx,
      conversation_label: LOCOMO_CONVERSATIONS[convIdx] ?? `Conv ${convIdx}`,
      retrieval,
      generation,
      judgment,
    };
  });

  return { schema_version: "1.0", metadata, metrics, evaluations };
}

// --- LongMemEval Adapter ---

function normalizeLongMemEval(
  evalData: Record<string, unknown>,
  predictData?: Record<string, unknown>,
): UnifiedEvalResult {
  const meta = evalData.metadata as Record<string, unknown>;
  const metricsByCutoff = evalData.metrics_by_cutoff as Record<
    string,
    Record<string, unknown>
  >;
  const rawEvals = evalData.evaluations as Record<string, unknown>[];

  const predictLookup = new Map<string, Record<string, unknown>>();
  if (predictData) {
    const questions = (predictData.questions ?? []) as Record<
      string,
      unknown
    >[];
    for (const q of questions) {
      predictLookup.set(q.question_id as string, q);
    }
  }

  const cutoffs = Object.keys(metricsByCutoff);
  const primaryCutoff = cutoffs[cutoffs.length - 1];
  const primaryMetrics = metricsByCutoff[primaryCutoff] as Record<
    string,
    unknown
  >;
  const overall = primaryMetrics.overall as Record<string, number>;
  const byType = primaryMetrics.by_question_type as Record<
    string,
    Record<string, number>
  >;

  const isAnswererMode =
    (meta.eval_mode as string) === "answerer" ||
    (meta.eval_mode as string) === "judge_only";

  const metadata: EvalMetadata = {
    eval_type: "longmemeval",
    project_name: (meta.project_name as string) ?? "unknown",
    timestamp: parseTimestamp(meta.timestamp as string),
    models: {
      answerer: (meta.generation_model as string) ?? (meta.model as string),
      judge: meta.model as string,
    },
    dataset: {
      name: "longmemeval_oracle",
      total_items: meta.total_questions as number,
      top_k_cutoffs: meta.top_k_cutoffs as string[],
    },
  };

  // Compute avg latencies from raw evaluations
  const searchLatencies = rawEvals
    .map((e) => e.search_latency_ms as number | undefined)
    .filter((v): v is number => v != null && v > 0);
  const addLatencies = rawEvals
    .map((e) => e.add_latency_total_ms as number | undefined)
    .filter((v): v is number => v != null && v > 0);
  const avgSearchLatency =
    searchLatencies.length > 0
      ? searchLatencies.reduce((a, b) => a + b, 0) / searchLatencies.length
      : undefined;
  const avgAddLatency =
    addLatencies.length > 0
      ? addLatencies.reduce((a, b) => a + b, 0) / addLatencies.length
      : undefined;

  const metrics: EvalMetrics = {
    overall: {
      total: overall.total,
      passed: overall.passed ?? overall.correct ?? 0,
      failed:
        overall.failed ??
        overall.total - (overall.passed ?? overall.correct ?? 0),
      errors: overall.errors ?? 0,
      accuracy: overall.pass_rate ?? overall.accuracy ?? 0,
      avg_score: overall.avg_score,
      avg_search_latency_ms: avgSearchLatency,
      avg_add_latency_ms: avgAddLatency,
    },
    by_group: {},
  };

  for (const [name, type] of Object.entries(byType)) {
    const groupEvals = rawEvals.filter((e) => e.question_type === name);
    const gSearchLats = groupEvals
      .map((e) => e.search_latency_ms as number | undefined)
      .filter((v): v is number => v != null && v > 0);
    const gAddLats = groupEvals
      .map((e) => e.add_latency_total_ms as number | undefined)
      .filter((v): v is number => v != null && v > 0);

    metrics.by_group![name] = {
      total: type.total,
      passed: type.passed ?? type.correct ?? 0,
      failed:
        type.failed ?? type.total - (type.passed ?? type.correct ?? 0),
      errors: 0,
      accuracy: type.pass_rate ?? type.accuracy ?? 0,
      avg_search_latency_ms:
        gSearchLats.length > 0
          ? gSearchLats.reduce((a, b) => a + b, 0) / gSearchLats.length
          : undefined,
      avg_add_latency_ms:
        gAddLats.length > 0
          ? gAddLats.reduce((a, b) => a + b, 0) / gAddLats.length
          : undefined,
    };
  }

  if (cutoffs.length > 1) {
    metrics.by_cutoff = {};
    for (const cutoff of cutoffs) {
      const cm = metricsByCutoff[cutoff] as Record<string, unknown>;
      const co = cm.overall as Record<string, number>;
      const ct = cm.by_question_type as Record<
        string,
        Record<string, number>
      >;
      metrics.by_cutoff[cutoff] = {
        overall: {
          total: co.total,
          passed: co.passed ?? co.correct ?? 0,
          failed:
            co.failed ?? co.total - (co.passed ?? co.correct ?? 0),
          errors: co.errors ?? 0,
          accuracy: co.pass_rate ?? co.accuracy ?? 0,
        },
        by_group: {},
      };
      for (const [name, type] of Object.entries(ct)) {
        metrics.by_cutoff[cutoff].by_group![name] = {
          total: type.total,
          passed: type.passed ?? type.correct ?? 0,
          failed:
            type.failed ?? type.total - (type.passed ?? type.correct ?? 0),
          errors: 0,
          accuracy: type.pass_rate ?? type.accuracy ?? 0,
        };
      }
    }
  }

  const evaluations: EvalItem[] = rawEvals.map((ev) => {
    const cutoffResults = ev.cutoff_results as
      | Record<string, Record<string, unknown>>
      | undefined;
    const primaryResult = cutoffResults?.[primaryCutoff];
    const predict = predictLookup.get(ev.question_id as string);

    let retrieval: RetrievalData | undefined;
    if (predict) {
      const ret = predict.retrieval as Record<string, unknown> | undefined;
      if (ret) {
        const searchResults = (ret.search_results ?? []) as Record<
          string,
          unknown
        >[];
        retrieval = {
          query: (ret.search_query as string) ?? (ev.question as string),
          latency_ms: ret.search_latency_ms as number | undefined,
          total_results:
            (ret.num_search_results as number) ?? searchResults.length,
          results: searchResults.map((sr, i) => ({
            rank: i + 1,
            memory: sr.memory as string,
            score: sr.score as number,
            id: sr.id as string | undefined,
            created_at: sr.created_at as string | undefined,
            score_debug: sr.score_debug as ScoreDebug | undefined,
          })),
          query_debug: ret.query_debug as QueryDebug | undefined,
        };
      }
    }

    let ingestion: IngestionData | undefined;
    if (predict?.ingestion) {
      const ing = predict.ingestion as Record<string, unknown>;
      const ops = (ing.operations ?? []) as Record<string, unknown>[];
      ingestion = {
        items_processed: (ing.num_pairs_processed as number) ?? 0,
        items_failed: (ing.num_pairs_failed as number) ?? 0,
        total_memories_created: (
          predict.memory_state as Record<string, unknown>
        )?.total_memory_count as number,
        operations: ops.map((op, i) => ({
          step: i,
          type:
            Object.keys(
              (op.response_summary as Record<string, Record<string, number>>)
                ?.events ?? { ADD: 0 },
            )[0] ?? "ADD",
          success: op.success as boolean,
        })),
      };
    }

    let judgment: JudgmentData | undefined;
    let generation: GenerationData | undefined;
    if (primaryResult) {
      const j = (primaryResult.judgment as string)?.toLowerCase();
      const isPass = j === "pass" || j === "correct";
      const rawReason = primaryResult.reason as string | undefined;

      // In answerer mode, the reason field contains "Generated answer: <answer>"
      if (isAnswererMode && rawReason?.startsWith("Generated answer:")) {
        const fullAnswer =
          (primaryResult.supporting_evidence as string) ||
          rawReason.replace(/^Generated answer:\s*/, "");
        generation = {
          model:
            (meta.generation_model as string) ??
            (meta.model as string) ??
            "unknown",
          answer: fullAnswer,
        };
      }

      judgment = {
        model: meta.model as string,
        verdict: isPass ? "correct" : "incorrect",
        score: isPass ? 1.0 : 0.0,
        reasoning: generation ? undefined : rawReason,
      };

      if (primaryResult.core_intent) {
        const intentStr = `Intent: ${primaryResult.core_intent}`;
        const evidenceStr = primaryResult.supporting_evidence
          ? `\n\nEvidence: ${primaryResult.supporting_evidence}`
          : "";
        if (generation) {
          judgment.reasoning = primaryResult.core_intent
            ? intentStr + evidenceStr
            : undefined;
        } else {
          judgment.reasoning = `${intentStr}\n\n${rawReason ?? ""}${evidenceStr}`;
        }
      } else if (generation) {
        const supported = primaryResult.core_intent_supported;
        judgment.reasoning =
          supported !== undefined
            ? `Core intent supported: ${supported ? "Yes" : "No"}`
            : undefined;
      }
    }

    return {
      id: ev.question_id as string,
      group: (ev.question_type as string) ?? "unknown",
      question: ev.question as string,
      ground_truth:
        (ev.ground_truth_answer as string) ??
        (ev.reference_answer as string) ??
        "",
      ingestion,
      retrieval,
      generation,
      judgment,
    };
  });

  return { schema_version: "1.0", metadata, metrics, evaluations };
}

// --- BEAM Adapter ---

function normalizeBeam(
  evalData: Record<string, unknown>,
  predictData?: Record<string, unknown>,
): UnifiedEvalResult {
  const meta = evalData.metadata as Record<string, unknown>;
  const metricsByCutoff = evalData.metrics_by_cutoff as Record<
    string,
    Record<string, unknown>
  >;
  const rawEvals = evalData.evaluations as Record<string, unknown>[];

  // Build predict lookup for retrieval enrichment
  const predictLookup = new Map<string, Record<string, unknown>>();
  if (predictData) {
    const questions = (predictData.questions ??
      predictData.evaluations ??
      []) as Record<string, unknown>[];
    for (const q of questions) {
      predictLookup.set(q.question_id as string, q);
    }
  }

  const cutoffs = Object.keys(metricsByCutoff);
  const primaryCutoff = cutoffs[cutoffs.length - 1];
  const primaryMetrics = metricsByCutoff[primaryCutoff] as Record<
    string,
    unknown
  >;
  const overall = primaryMetrics.overall as Record<string, number>;
  const byType = primaryMetrics.by_question_type as Record<
    string,
    Record<string, number>
  >;

  const metadata: EvalMetadata = {
    eval_type: "beam",
    project_name: (meta.project_name as string) ?? "unknown",
    timestamp: parseTimestamp(meta.timestamp as string),
    models: {
      answerer: meta.answerer_model as string,
      judge: meta.judge_model as string,
    },
    dataset: {
      name: "beam",
      total_items: meta.total_questions as number,
      top_k_cutoffs: meta.top_k_cutoffs as string[],
      categories: meta.chat_sizes as string[],
    },
  };

  // Compute avg latencies
  const searchLatencies = rawEvals
    .map((e) => e.search_latency_ms as number | undefined)
    .filter((v): v is number => v != null && v > 0);
  const avgSearchLatency =
    searchLatencies.length > 0
      ? searchLatencies.reduce((a, b) => a + b, 0) / searchLatencies.length
      : undefined;

  // BEAM scores are 0-1 scale. Use 0.5 threshold for passed/failed.
  const passThreshold = 0.5;
  const evalScores = rawEvals.map((e) => {
    const cr = (
      e.cutoff_results as Record<string, Record<string, unknown>>
    )?.[primaryCutoff];
    return (cr?.score as number) ?? 0;
  });

  const metrics: EvalMetrics = {
    overall: {
      total: overall.total ?? rawEvals.length,
      passed: evalScores.filter((s) => s >= passThreshold).length,
      failed: evalScores.filter((s) => s < passThreshold).length,
      errors: 0,
      accuracy: (overall.avg_score ?? 0) * 100,
      avg_score: overall.avg_score,
      avg_search_latency_ms: avgSearchLatency,
    },
    by_group: {},
  };

  for (const [name, type] of Object.entries(byType)) {
    const groupEvals = rawEvals.filter((e) => e.question_type === name);
    const groupScores = groupEvals.map((e) => {
      const cr = (
        e.cutoff_results as Record<string, Record<string, unknown>>
      )?.[primaryCutoff];
      return (cr?.score as number) ?? 0;
    });
    const groupSearchLats = groupEvals
      .map((e) => e.search_latency_ms as number | undefined)
      .filter((v): v is number => v != null && v > 0);

    metrics.by_group![name] = {
      total: type.total ?? groupEvals.length,
      passed: groupScores.filter((s) => s >= passThreshold).length,
      failed: groupScores.filter((s) => s < passThreshold).length,
      errors: 0,
      accuracy: (type.avg_score ?? 0) * 100,
      avg_score: type.avg_score,
      avg_search_latency_ms:
        groupSearchLats.length > 0
          ? groupSearchLats.reduce((a, b) => a + b, 0) /
            groupSearchLats.length
          : undefined,
    };
  }

  // Multi-cutoff support
  if (cutoffs.length > 1) {
    metrics.by_cutoff = {};
    for (const cutoff of cutoffs) {
      const cm = metricsByCutoff[cutoff] as Record<string, unknown>;
      const co = cm.overall as Record<string, number>;
      const ct = cm.by_question_type as Record<
        string,
        Record<string, number>
      >;
      metrics.by_cutoff[cutoff] = {
        overall: {
          total: co.total,
          passed: co.correct ?? 0,
          failed: co.total - (co.correct ?? 0),
          errors: 0,
          accuracy: (co.avg_score ?? 0) * 100,
          avg_score: co.avg_score,
        },
        by_group: {},
      };
      for (const [name, type] of Object.entries(ct)) {
        metrics.by_cutoff[cutoff].by_group![name] = {
          total: type.total,
          passed: type.correct ?? 0,
          failed: type.total - (type.correct ?? 0),
          errors: 0,
          accuracy: (type.avg_score ?? 0) * 100,
          avg_score: type.avg_score,
        };
      }
    }
  }

  // Build evaluations
  const evaluations: EvalItem[] = rawEvals.map((ev) => {
    const cutoffResults = ev.cutoff_results as Record<
      string,
      Record<string, unknown>
    >;
    const primaryResult = cutoffResults?.[primaryCutoff];
    const predict = predictLookup.get(ev.question_id as string);

    // Build retrieval from predict data if available
    let retrieval: RetrievalData | undefined;
    if (predict) {
      const ret = predict.retrieval as Record<string, unknown> | undefined;
      if (ret) {
        const searchResults = (ret.search_results ?? []) as Record<
          string,
          unknown
        >[];
        retrieval = {
          query: (ret.search_query as string) ?? (ev.question as string),
          latency_ms: ret.search_latency_ms as number | undefined,
          total_results:
            (ret.total_results as number) ?? searchResults.length,
          results: searchResults.map((sr, i) => ({
            rank: i + 1,
            memory: sr.memory as string,
            score: sr.score as number,
            id: sr.id as string | undefined,
            created_at: sr.created_at as string | undefined,
            score_debug: sr.score_debug as ScoreDebug | undefined,
          })),
          query_debug: ret.query_debug as QueryDebug | undefined,
        };
      }
    }

    // Build judgment with key_facts from rubric nugget scores
    let judgment: JudgmentData | undefined;
    if (primaryResult) {
      const score = (primaryResult.score as number) ?? 0;
      const nuggetScores = (primaryResult.nugget_scores ?? []) as Record<
        string,
        unknown
      >[];

      const keyFacts: KeyFact[] = nuggetScores.map((ns) => ({
        fact: ns.nugget as string,
        status: ((ns.score as number) >= 0.5
          ? "supported"
          : "missing") as "supported" | "missing",
        evidence: `Score: ${ns.score}${ns.reason ? ` -- ${ns.reason}` : ""}`,
      }));

      const tauNorm = primaryResult.tau_norm as number | undefined;
      let reasoning = `Rubric score: ${score.toFixed(2)} (${nuggetScores.length} nuggets)`;
      if (tauNorm != null) {
        reasoning += ` | Kendall tau: ${tauNorm.toFixed(2)}`;
      }

      judgment = {
        model: meta.judge_model as string,
        verdict: score >= passThreshold ? "correct" : "incorrect",
        score,
        reasoning,
        key_facts: keyFacts.length > 0 ? keyFacts : undefined,
      };
    }

    // Build generation
    let generation: GenerationData | undefined;
    if (primaryResult?.generated_answer) {
      generation = {
        model: (meta.answerer_model as string) ?? "unknown",
        answer: primaryResult.generated_answer as string,
      };
    }

    const convIdx = ev.conversation_idx as number;
    const chatSize = ev.chat_size as string;
    return {
      id: ev.question_id as string,
      group: (ev.question_type as string) ?? "unknown",
      question: ev.question as string,
      ground_truth: ((ev.rubric as string[]) ?? []).join(" | "),
      conversation_idx: convIdx,
      conversation_label: `${chatSize} Conv ${convIdx}`,
      retrieval,
      generation,
      judgment,
    };
  });

  return { schema_version: "1.0", metadata, metrics, evaluations };
}

// --- Fallback ---

function normalizeFallback(data: Record<string, unknown>): UnifiedEvalResult {
  const meta = data.metadata as Record<string, unknown> | undefined;
  return {
    schema_version: "1.0",
    metadata: {
      eval_type: "unknown",
      project_name: (meta?.project_name as string) ?? "imported",
      timestamp: new Date().toISOString(),
      models: {},
      dataset: { name: "unknown", total_items: 0 },
    },
    metrics: {
      overall: { total: 0, passed: 0, failed: 0, errors: 0, accuracy: 0 },
      by_group: {},
    },
    evaluations: [],
  };
}

// --- Helpers ---

function parseTimestamp(ts: string | undefined): string {
  if (!ts) return new Date().toISOString();
  const match = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).toISOString();
  }
  return new Date().toISOString();
}
