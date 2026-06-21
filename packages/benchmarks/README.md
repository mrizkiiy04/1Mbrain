# 1MBrain Provider Benchmarks

Provider-level benchmarks compare memory engines without involving an LLM agent.
Hermes or other agents should be tested later as an end-to-end validation layer.

## Run

```bash
npm run build --workspace=packages/core
npm run bench --workspace=packages/benchmarks
```

## Focused Mini Dataset

A small GitHub-friendly fixture is available at
`packages/benchmarks/fixtures/1mbrain-focused-mini/1mbrain-focused-mini.json`.
It contains 5 directed conversations, 41 memory records, and 23 questions that
target 1MBrain-specific behavior without requiring an LLM judge.

Optional dataset scales:

```bash
BENCH_SCALES=1,10,100 npm run bench --workspace=packages/benchmarks
```

Optional provider filter:

```bash
BENCH_PROVIDERS=1mbrain-sqlite-vector-bulk,1mbrain-sqlite-graph-bulk,qdrant-vector npm run bench --workspace=packages/benchmarks
```

Each scale adds 50 noise memories plus the fixed ground-truth memories.

## Current Providers

- `1mbrain-sqlite-vector`: SQLite storage with vector-only recall.
- `1mbrain-sqlite-graph`: SQLite storage with spreading activation enabled.
- `1mbrain-sqlite-vector-bulk`: SQLite vector recall after direct bulk load, bypassing
  `remember()` auto-association.
- `1mbrain-sqlite-graph-bulk`: SQLite graph recall after direct bulk load plus explicit
  dataset associations only.
- `qdrant-vector`: Qdrant vector recall, enabled only when `QDRANT_URL` is set.

## Qdrant Local Benchmark

Start Qdrant with Docker Compose:

```bash
docker compose --profile qdrant up -d qdrant
```

Then run:

```bash
QDRANT_URL=http://localhost:6333 npm run bench --workspace=packages/benchmarks
```

Optional:

```bash
QDRANT_COLLECTION=one_million_brain_bench
QDRANT_API_KEY=...
```

If `QDRANT_URL` is not set or unreachable, the Qdrant provider is skipped and local
1MBrain providers still run.

## Metrics

- `recallAt5`, `recallAt10`: fraction of expected memories retrieved in top K.
- `mrrAt10`: reciprocal rank of the first correct hit.
- `ndcgAt10`: rank-sensitive quality score for all expected hits.
- `p50Ms`, `p95Ms`: recall latency percentiles.
- `setupMs`: dataset load and association creation time.

Results are written to `packages/benchmarks/results/*.json` and `*.csv`.

## Interpreting Setup Modes

The non-bulk 1MBrain providers use `MemoryEngine.remember()`, which includes embedding,
event emission, and auto-association. This is closest to normal runtime writes.

The `*-bulk` providers write directly through `DatabaseProvider.bulkCreateMemories()`
and `bulkCreateAssociations()`. This isolates retrieval/storage behavior and makes
the setup comparison fairer against vector databases that use batch upsert.
