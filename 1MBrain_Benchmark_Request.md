# Benchmark Request — 1MBrain vs Other Memory Providers

## Role

You are a senior AI systems benchmark engineer. Your task is to design and run a fair, reproducible benchmark comparing **1MBrain** against other AI memory providers.

The benchmark must not only test vector similarity search. It must evaluate whether a memory provider improves real AI agent behavior through long-term recall, graph association, memory freshness, portability, and context injection.

---

## Background

1MBrain is a portable memory layer for AI agents. It is designed around these capabilities:

- `remember()` — store memory with metadata.
- `recall()` — retrieve relevant memory.
- `forget()` — remove memory.
- `associate()` — link related memories.
- `decay()` — reduce unused memory priority over time.
- Association graph — memories are connected through similarity, co-occurrence, and explicit links.
- Spreading activation — recall can expand from relevant memories into connected memories.
- Vector + graph retrieval — not just vector similarity.
- Memory Passport — export/import memory across agents or storage backends.
- Multiple backend options — OpenAI/Ollama embeddings and SQLite/PostgreSQL vector storage.

The main question:

> Does 1MBrain produce better long-term agent memory behavior than typical memory providers?

---

## Providers to Compare

Please compare 1MBrain against these providers or baselines where possible:

| Provider | Purpose |
|---|---|
| 1MBrain | Target system |
| Vector-only baseline | Simple embedding + vector DB retrieval |
| Mem0 | Popular AI memory provider |
| Zep / Graphiti | Temporal graph-based memory |
| Letta | Agent memory framework |
| LangMem | LangGraph-oriented memory manager |

If any provider cannot be tested due to setup/API limitations, document the reason clearly and continue with the remaining providers.

---

## Fairness Rules

Use the same conditions across all providers:

1. Same LLM model for final answer generation.
2. Same embedding model where possible.
3. Same dataset.
4. Same user questions.
5. Same top-k retrieval limit.
6. Same context budget.
7. Same evaluation rubric.
8. Same temperature setting.
9. Same number of trials.
10. Same hardware/runtime environment where possible.

Do not give one provider access to extra context, reranking, or tools unless all providers get the same capability.

---

## Benchmark Goals

The benchmark must evaluate these areas:

| Benchmark Area | What to Test |
|---|---|
| Retrieval accuracy | Can the provider retrieve the correct memory? |
| Multi-hop recall | Can it answer questions requiring connected memories? |
| Memory update | Can it prefer newer facts over outdated ones? |
| Selective forgetting | Can it ignore or remove irrelevant/stale memory? |
| Context injection quality | Does retrieved memory improve the final agent answer? |
| Evidence grounding | Does the answer use the correct supporting memory? |
| Portability | Can memory be exported/imported and still recalled correctly? |
| Cost and latency | How expensive and fast is the system? |

---

## Required Benchmark Scenarios

Please implement at least these scenarios.

---

### Scenario 1 — Basic Semantic Recall

Store simple user/project memories.

Example memory:

```txt
The user prefers building local-first AI tools using TypeScript and PostgreSQL.
```

Question:

```txt
What technology stack does the user prefer for AI tools?
```

Expected behavior:

- Correct memory appears in top-k.
- Final answer mentions TypeScript and PostgreSQL.
- No unrelated memory is injected.

Metrics:

- Precision@K
- Recall@K
- MRR
- Answer accuracy

---

### Scenario 2 — Multi-Hop Association Recall

Store memories that are individually incomplete but connected.

Example memories:

```txt
Memory A: Project Kreasa is an AI mentor app.
Memory B: Kreasa uses generated tasks to help users learn skills.
Memory C: The current weakness of Kreasa is that the AI mentor gives material that is not specific enough.
```

Question:

```txt
What is the main weakness of the user's AI mentor app?
```

Expected behavior:

- System connects Kreasa → AI mentor app → weakness.
- 1MBrain should benefit from association graph/spreading activation.
- Vector-only baseline may retrieve only one partial memory.

Metrics:

- Multi-hop answer accuracy
- Supporting memory coverage
- Graph expansion usefulness
- Hallucination rate

---

### Scenario 3 — Memory Update / Stale Fact Handling

Store old and new conflicting facts.

Example memories:

```txt
Old memory: The project uses Gemini 2.5 Flash as the main AI model.
New memory: The project is moving to DeepSeek V4 Pro for coding-focused tasks.
```

Question:

```txt
Which model is currently planned for coding-focused tasks?
```

Expected behavior:

- Provider should prefer the newer memory.
- Final answer should not claim Gemini is still the current plan.

Metrics:

- Update correctness
- Temporal correctness
- Stale memory error rate

---

### Scenario 4 — Noise Resistance

Store useful memory mixed with noisy memory.

Example noise:

```txt
Subscribe now.
Click here to learn more.
This website uses cookies.
Advertisement.
Sponsored content.
```

Question:

```txt
What is the actual project decision about memory storage?
```

Expected behavior:

- Provider ignores noisy memory.
- Relevant factual memory is retrieved.
- Answer is not polluted by ads or boilerplate.

Metrics:

- Noise retrieval rate
- Precision@K
- Answer relevance

---

### Scenario 5 — Selective Forgetting

Store a memory, verify retrieval, then delete or forget it.

Example:

```txt
The user used to prefer Firebase for backend storage.
```

Then run:

```txt
forget(memory_id)
```

Question:

```txt
What backend storage does the user prefer?
```

Expected behavior:

- Forgotten memory should not appear.
- The model should not answer using deleted information.
- If no valid memory exists, the answer should abstain.

Metrics:

- Forget success rate
- Deleted-memory leakage rate
- Abstention correctness

---

### Scenario 6 — Decay + Refresh

Store multiple memories with different access patterns.

Example:

```txt
Memory A: Frequently accessed project decision.
Memory B: Rarely accessed old experiment.
Memory C: Irrelevant one-time note.
```

Repeatedly recall Memory A, do not recall Memory B/C.

Expected behavior:

- Frequently accessed memories stay high priority.
- Unused memories decay or rank lower.
- Retrieval remains useful over time.

Metrics:

- Ranking movement over time
- Decay correctness
- Refresh effectiveness

---

### Scenario 7 — Memory Passport / Portability

For 1MBrain, test export/import.

Steps:

1. Store a set of memories.
2. Export memory passport.
3. Import into a fresh agent namespace or fresh database.
4. Run the same recall questions.

Expected behavior:

- Imported memories are searchable.
- Associations are preserved where possible.
- Retrieval quality should remain similar before and after migration.

Metrics:

- Export success
- Import success
- Recall quality after import
- Association preservation rate

---

### Scenario 8 — Agent Task Success

Test not only retrieval, but final agent performance.

Example task:

```txt
Write a short product positioning statement for the user's memory provider based on all remembered project decisions.
```

Expected behavior:

- Agent uses relevant memories.
- Agent avoids outdated or noisy facts.
- Output is coherent and faithful to memory.

Metrics:

- Task success score
- Faithfulness score
- Evidence accuracy
- Hallucination rate
- Context usefulness score

---

## Dataset Requirements

Create a benchmark dataset with this structure:

```json
{
  "scenario_id": "multi_hop_001",
  "memories": [
    {
      "id": "m1",
      "content": "Project Kreasa is an AI mentor app.",
      "type": "semantic",
      "timestamp": "2026-06-01T10:00:00Z",
      "tags": ["project", "kreasa", "ai-mentor"]
    }
  ],
  "question": "What is the main weakness of the user's AI mentor app?",
  "expected_answer": "The AI mentor gives material that is not specific enough.",
  "required_memory_ids": ["m1", "m2", "m3"],
  "forbidden_memory_ids": [],
  "evaluation_type": "multi_hop"
}
```

Please create at least:

| Scenario Type | Minimum Count |
|---|---:|
| Basic semantic recall | 30 |
| Multi-hop recall | 30 |
| Memory update | 30 |
| Noise resistance | 20 |
| Selective forgetting | 20 |
| Decay/refresh | 20 |
| Portability | 10 |
| Agent task success | 20 |

Minimum total: **180 benchmark cases**.

---

## Metrics to Report

Please calculate and report:

```txt
Precision@1
Precision@3
Precision@5
Recall@3
Recall@5
MRR
Answer Accuracy
Evidence Accuracy
Hallucination Rate
Abstention Accuracy
Temporal Correctness
Stale Memory Error Rate
Deleted Memory Leakage Rate
Average Latency
p50 Latency
p95 Latency
Estimated Cost per 1000 Queries
Storage Size
Import/Export Success Rate
```

---

## Evaluation Method

Use two evaluation layers:

### 1. Deterministic Evaluation

Use exact checks where possible:

- Did required memory ID appear in top-k?
- Did forbidden memory ID appear?
- Was deleted memory retrieved?
- Was newer memory preferred over older memory?
- Did imported memory still recall correctly?

### 2. LLM-as-Judge Evaluation

Use an LLM judge only for answer quality.

Judge rubric:

```txt
Score from 0 to 5.

5 = Fully correct, grounded in the right memory, no hallucination.
4 = Mostly correct, minor missing detail.
3 = Partially correct, uses some relevant memory but incomplete.
2 = Weak answer, vague or only loosely related.
1 = Mostly wrong.
0 = Hallucinated or contradicts the memory.
```

Also ask the judge to classify:

```txt
faithful: true/false
uses_stale_memory: true/false
uses_deleted_memory: true/false
unsupported_claims: true/false
```

---

## Required Output Files

Please produce the following files:

```txt
benchmark/
  README.md
  datasets/
    synthetic_memory_benchmark.json
  adapters/
    1mbrain.ts
    vector_baseline.ts
    mem0.ts
    zep_graphiti.ts
    letta.ts
    langmem.ts
  runners/
    ingest.ts
    recall.ts
    answer.ts
    evaluate.ts
  results/
    raw_results.json
    metrics_summary.json
    leaderboard.md
    failure_analysis.md
  reports/
    benchmark_report.md
```

If implementing all adapters is too much, start with:

```txt
1mbrain.ts
vector_baseline.ts
mem0.ts
zep_graphiti.ts
```

Then leave TODO notes for Letta and LangMem.

---

## Adapter Interface

Use a common interface like this:

```ts
export type MemoryRecord = {
  id: string;
  content: string;
  type?: string;
  timestamp?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type RecallResult = {
  memoryId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export interface MemoryProviderAdapter {
  name: string;

  reset(): Promise<void>;

  remember(memory: MemoryRecord): Promise<void>;

  recall(query: string, options?: {
    limit?: number;
    maxHops?: number;
    blendWeight?: number;
  }): Promise<RecallResult[]>;

  forget?(memoryId: string): Promise<void>;

  exportMemory?(): Promise<unknown>;

  importMemory?(payload: unknown): Promise<void>;
}
```

---

## 1MBrain-Specific Test Settings

When testing 1MBrain, run at least three configurations:

```txt
1mbrain_vector_only
- graph disabled or maxHops = 0
- blendWeight = 0

1mbrain_graph_light
- maxHops = 1
- blendWeight = 0.25

1mbrain_graph_full
- maxHops = 2 or 3
- blendWeight = 0.35 to 0.50
```

This is important to prove whether the graph actually improves recall.

---

## Leaderboard Format

Create a leaderboard table like this:

| Provider | Answer Accuracy | Evidence Accuracy | Recall@5 | MRR | Hallucination Rate | p95 Latency | Cost / 1k Queries |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1MBrain Graph Full | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| 1MBrain Vector Only | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Vector Baseline | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Mem0 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Zep/Graphiti | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

---

## Failure Analysis Required

For every provider, identify failure patterns:

```txt
- Missed memory
- Retrieved similar but wrong memory
- Used stale memory
- Used deleted memory
- Could not connect multi-hop facts
- Injected too much context
- Hallucinated unsupported details
- High latency
- High cost
- Import/export failed
```

For 1MBrain specifically, analyze:

```txt
- Did graph retrieval improve or hurt?
- Did spreading activation retrieve useful connected memories?
- Did graph expansion introduce irrelevant memories?
- Did decay improve ranking over time?
- Did Memory Passport preserve recall quality?
```

---

## Final Report Requirements

The final report must answer:

1. Where does 1MBrain outperform typical vector-only memory?
2. Where does 1MBrain underperform?
3. Does association graph improve recall quality?
4. Does spreading activation improve multi-hop reasoning?
5. Does decay/refresh help prevent stale memory pollution?
6. Is Memory Passport practically useful?
7. What is the tradeoff between quality, latency, and cost?
8. What should be improved before public release?

---

## Important Rule

Do not write marketing claims unless the benchmark data supports them.

Use this style:

```txt
Supported claim:
1MBrain improved multi-hop recall accuracy by X% over vector-only baseline on the synthetic benchmark.

Unsupported claim:
1MBrain is the best memory provider.
```

---

## Deliverable

Please implement the benchmark harness, run the benchmark, and produce:

1. Dataset file.
2. Provider adapters.
3. Raw results.
4. Metrics summary.
5. Leaderboard.
6. Failure analysis.
7. Final benchmark report.

The result should be reproducible with one command, for example:

```bash
pnpm benchmark
```

or:

```bash
python -m benchmark.run
```
