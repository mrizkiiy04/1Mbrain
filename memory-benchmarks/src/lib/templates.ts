import { getDb } from "./db";

export interface EvalTemplate {
  id: string;
  name: string;
  eval_type: string;
  script_path: string;
  description: string;
  default_config: string;
  default_eval_config: string;
  created_at: string;
}

const SEED_TEMPLATES = [
  {
    id: "locomo",
    name: "LOCOMO-10",
    eval_type: "benchmark",
    script_path: "benchmarks/locomo/run.py",
    description:
      "LOCOMO-10 benchmark -- 10 multi-hop conversations, 4 question categories " +
      "(single-hop, multi-hop, temporal, open-domain).",
    default_config: JSON.stringify({
      conversations: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      max_workers: 10,
      top_k: 200,
      debug: true,
      score_debug: true,
    }),
    default_eval_config: JSON.stringify({
      answerer_model: "gpt-4o",
      judge_model: "gpt-4o",
      provider: "openai",
      top_k_cutoffs: "10,20,50,200",
    }),
  },
  {
    id: "longmemeval",
    name: "LongMemEval",
    eval_type: "benchmark",
    script_path: "benchmarks/longmemeval/run.py",
    description:
      "LongMemEval-S benchmark -- 500 questions, 6 types, full haystack (~50 sessions/question).",
    default_config: JSON.stringify({
      all_questions: true,
      max_workers: 120,
      top_k: 100,
    }),
    default_eval_config: JSON.stringify({
      answerer_model: "gpt-4o",
      judge_model: "gpt-4o",
      provider: "openai",
      mode: "answerer",
      top_k_cutoffs: "200",
    }),
  },
  {
    id: "beam",
    name: "BEAM",
    eval_type: "benchmark",
    script_path: "benchmarks/beam/run.py",
    description:
      "BEAM benchmark (ICLR 2026) -- 100 conversations across 4 size buckets (100K-10M tokens), " +
      "20 probing questions per conversation across 10 memory ability types. " +
      "Rubric-based nugget scoring with LLM-as-judge.",
    default_config: JSON.stringify({
      chat_sizes: ["100K"],
      conversations: "0-99",
      max_workers: 10,
      top_k: 200,
      debug: true,
      score_debug: true,
    }),
    default_eval_config: JSON.stringify({
      answerer_model: "gpt-4o",
      judge_model: "gpt-4o",
      provider: "openai",
      top_k_cutoffs: "10,20,50,200",
    }),
  },
];

let _seeded = false;

export function seedTemplates() {
  if (_seeded) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO eval_templates
      (id, name, eval_type, script_path, description, default_config, default_eval_config)
    VALUES (@id, @name, @eval_type, @script_path, @description, @default_config, @default_eval_config)
  `);
  const tx = db.transaction(() => {
    for (const t of SEED_TEMPLATES) {
      insert.run(t);
    }
  });
  tx();
  _seeded = true;
}

export function getTemplates(): EvalTemplate[] {
  seedTemplates();
  return getDb()
    .prepare("SELECT * FROM eval_templates ORDER BY name")
    .all() as EvalTemplate[];
}

export function getTemplate(id: string): EvalTemplate | undefined {
  seedTemplates();
  return getDb()
    .prepare("SELECT * FROM eval_templates WHERE id = ?")
    .get(id) as EvalTemplate | undefined;
}
