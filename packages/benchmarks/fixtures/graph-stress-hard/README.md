# Graph Stress Hard Benchmark

This fixture is a diagnostic benchmark for graph-aware memory retrieval. It is
intentionally harder and less provider-neutral than the Claude balanced and
realistic fixtures.

## Purpose

Use this dataset to tune and compare:

- Multi-hop association recall.
- Conflict and current-state resolution.
- Graph traversal with weak lexical overlap.
- Near-entity distractor resistance.
- Abstention when only a similar entity has the requested fact.

## Shape

- 12 conversations.
- 144 memory records.
- 60 questions.
- Deterministic generation from `generate_graph_stress_hard.js`.

## Category Mix

- 24 `multi_hop_association`.
- 12 `contradiction_resolution`.
- 12 `graph_traversal`.
- 7 `entity_disambiguation`.
- 5 `abstention`.

## Usage

```powershell
node packages/benchmarks/fixtures/graph-stress-hard/generate_graph_stress_hard.js
$env:BENCH_DATASET = "graph-stress-hard"
$env:BENCH_PROVIDERS = "1mbrain_graph_full,1mbrain_vector_only,vector_baseline"
node packages/benchmarks/dist/runner.js
```

This is best interpreted alongside provider-neutral datasets. A graph-enabled
provider should separate itself most clearly on `multi_hop_recall` and
`memory_update` metrics.
