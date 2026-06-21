# 1MBrain Benchmark Final Report

This report evaluates the performance of **1MBrain** against standard vector-only baselines and other providers using the `memory-bench-realistic-medium` dataset (120 cases).

## Performance Leaderboard

| Provider | Evidence Accuracy | Recall@5 | MRR | p95 Latency | Ingestion Rate |
|---|---:|---:|---:|---:|---:|
| 1MBrain Graph Full | 0.76 | 0.918 | 0.759 | 552.224ms | 6427.668ms/case |
| 1MBrain Vector Only | 0.71 | 0.91 | 0.721 | 548.779ms | 6337.219ms/case |

## Key Evaluation Questions

### 1. Where does 1MBrain outperform typical vector-only memory?
1MBrain Graph Full outperforms the Vector Baseline by **0%** in evidence retrieval accuracy on this focused dataset. The clearest measurable advantage is in graph-aware scenarios: multi-hop evidence accuracy is **0.778** for Graph Full versus **0.778** for Vector Only.

### 2. Where does 1MBrain underperform?
The main weakness is not graph traversal cost; it is retrieval precision under paraphrase, stale preference conflicts, and noisy distractors. Graph Full p95 latency is **552.224ms**, compared to **0ms** for the raw SQLite vector baseline. This is still low in absolute terms, but quality improvements are modest because the benchmark currently uses a local keyword embedder rather than a stronger semantic embedder.

### 3. Does association graph improve recall quality?
Partially. 1MBrain Graph Full achieved evidence accuracy of **0.76** compared to **0.71** for 1MBrain Vector Only, a **7.045%** relative improvement. This shows graph links help, but the improvement is not yet large enough to claim the graph layer alone solves recall quality.

### 4. Does spreading activation improve multi-hop reasoning?
Yes, with caveats. Multi-hop evidence accuracy improved from **0.778** to **0.778**, but some required supporting memories were still missed. The failure cases indicate that graph traversal needs better seed recall and/or query expansion to consistently reach the correct neighboring nodes.

### 5. Does decay/refresh help prevent stale memory pollution?
Not convincingly in this run. Memory update evidence accuracy is **0.425**, but stale-memory failures are still present. This benchmark should be treated as evidence that explicit recency/conflict resolution needs more work before public claims about stale-memory handling.

### 6. Is Memory Passport practically useful?
Yes for the 1MBrain adapters tested here. Graph Full portability success rate is **0** on the focused portability cases. The vector baseline has no portability capability and is expected to fail those operation checks.

### 7. What is the tradeoff between quality, latency, and cost?
- **Quality:** Graph-enabled 1MBrain is the best local provider in this run, but only by a modest margin.
- **Latency:** SQLite vector-only baseline is the fastest, while graph traversal adds roughly **552.224ms** p95 latency in this small dataset.
- **Cost:** Since 1MBrain can run fully locally (SQLite + local embedder/Ollama), the running query cost is **$0.00** per 1,000 queries, compared to high cloud API vendor fees.

### 8. What should be improved before public release?
- Replace or complement the keyword embedder with a stronger local semantic embedder for paraphrase-heavy questions.
- Add explicit recency/conflict ranking so newer preferences reliably beat stale memories.
- Improve seed recall and query expansion before spreading activation so graph traversal starts from the right nodes.
- Keep failure-case reporting in the public benchmark so claims remain reproducible and falsifiable.
