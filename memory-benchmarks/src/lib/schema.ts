/**
 * Unified Eval Result Schema v1.0
 *
 * Every eval run -- regardless of type (locomo, longmemeval, beam) -- gets
 * normalized into this shape. This is the single source of truth for the
 * frontend and any analysis tooling.
 *
 * Design principles:
 *   1. Every pipeline stage (ingest -> retrieve -> generate -> judge) is
 *      a first-class section in each evaluation item.
 *   2. Stages can be null/absent -- a predict-only run won't have
 *      generation or judgment.
 *   3. Retrieved memories are ALWAYS preserved -- they're the most
 *      important debugging artifact.
 *   4. Grouping is generic: "group" covers category (locomo),
 *      question_type (longmemeval/beam), or any future dimension.
 */

// --- Top-level result ---

export interface UnifiedEvalResult {
  schema_version: "1.0";
  metadata: EvalMetadata;
  metrics: EvalMetrics;
  evaluations: EvalItem[];
}

// --- Metadata ---

export interface EvalMetadata {
  eval_type: string;
  project_name?: string;
  timestamp?: string;
  models?: {
    answerer?: string;
    judge?: string;
    embedding?: string;
  };
  capabilities?: {
    has_answer_sessions: boolean;
    has_ingestion_debug: boolean;
    has_ground_truth_evidence: boolean;
  };
  dataset?: {
    name: string;
    total_items: number;
    top_k_cutoffs?: string[];
    categories?: (string | number)[];
  };
  config?: Record<string, unknown>;
}

// --- Metrics ---

export interface MetricBucket {
  total: number;
  passed: number;
  failed: number;
  errors?: number;
  accuracy: number; // 0-100
  avg_score?: number;
  avg_search_latency_ms?: number;
  avg_add_latency_ms?: number;
}

export interface EvalMetrics {
  overall: MetricBucket;
  by_group?: Record<string, MetricBucket>;
  by_cutoff?: Record<
    string,
    {
      overall: MetricBucket;
      by_group?: Record<string, MetricBucket>;
    }
  >;
}

// --- Per-evaluation item ---

export interface EvalItem {
  id: string;
  group: string; // category_name / question_type
  question: string;
  ground_truth: string;

  // Optional context
  conversation_idx?: number;
  conversation_label?: string;
  turn_number?: number;

  // Pipeline stages -- each is optional
  ingestion?: IngestionData;
  retrieval?: RetrievalData;
  generation?: GenerationData;
  judgment?: JudgmentData;
}

// --- Ingestion ---

export interface IngestionOperation {
  step: number;
  type: string; // ADD, UPDATE, DELETE
  memory?: string;
  old_memory?: string;
  success: boolean;
  latency_ms?: number;
}

export interface IngestionData {
  items_processed: number;
  items_failed: number;
  total_memories_created?: number;
  operations?: IngestionOperation[];
}

// --- Retrieval ---

export interface ScoreDebug {
  combined_score?: number;
  semantic_score?: number;
  bm25_score?: number;
  entity_boost?: number;
  lineage_boost?: number;
  rrf_score?: number;
  final_rank?: number;
  vector_sim?: number;
  vector_rank?: number;
  bm25_rank?: number;
  in_vector?: boolean;
  in_bm25?: boolean;
}

export interface QueryDebug {
  scoring_mode?: string;
  vector_candidates?: number;
  bm25_candidates?: number;
  bm25_params?: {
    midpoint?: number;
    steepness?: number;
    bm25_query_text?: string;
  };
  entity_boost_weight?: number;
  lineage_boost_factor?: number;
}

export interface RetrievedMemory {
  rank: number;
  memory: string;
  score: number;
  id?: string;
  created_at?: string;
  score_debug?: ScoreDebug;
}

export interface RetrievalData {
  query: string;
  latency_ms?: number;
  results: RetrievedMemory[];
  total_results: number;
  query_debug?: QueryDebug;
}

// --- Generation ---

export interface GenerationData {
  model: string;
  answer: string;
  latency_ms?: number;
}

// --- Judgment ---

export interface KeyFact {
  fact: string;
  status: "supported" | "missing" | "wrong";
  evidence?: string;
}

export interface JudgmentData {
  model?: string;
  verdict: "correct" | "incorrect" | "error";
  score: number; // 0.0 - 1.0
  reasoning?: string;
  key_facts?: KeyFact[];
  latency_ms?: number;
}
