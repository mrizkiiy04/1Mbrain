# Memory Benchmarks

Open-source evaluation suite to run benchmarks on memory-augmented LLM systems. Currently supports the [Mem0](https://github.com/mem0ai/mem0) Cloud and OSS versions to measure memory recall, extraction quality, and retrieval accuracy.

## Benchmarks

| Benchmark | Dataset | Questions | What it tests |
|-----------|---------|-----------|---------------|
| **LOCOMO** | 10 multi-session dialogues | ~300 | Factual recall, temporal reasoning, multi-hop inference |
| **LongMemEval** | 500 diverse questions, 6 types | 500 | Long-term memory across information extraction, temporal, and multi-session reasoning |
| **BEAM** | 100 conversations per size bucket (100K–10M tokens) | 2,000+ | Real-world memory retrieval across 10 memory ability types |

## Quick Start

```bash
git clone https://github.com/mem0ai/memory-benchmarks.git
cd memory-benchmarks
pip install -r requirements.txt
```

### Option A: Mem0 Cloud

No Docker required. You need a [Mem0 API key](https://app.mem0.ai) and an OpenAI API key (for the answerer/judge LLM).

```bash
# Set your keys
export MEM0_API_KEY=m0-your-key
export OPENAI_API_KEY=sk-your-key

# Run a benchmark
python -m benchmarks.locomo.run \
  --project-name my-first-test \
  --backend cloud \
  --mem0-api-key $MEM0_API_KEY

# LongMemEval (500 questions)
python -m benchmarks.longmemeval.run \
  --project-name my-first-test \
  --backend cloud \
  --mem0-api-key $MEM0_API_KEY \
  --all-questions

# BEAM (configurable size)
python -m benchmarks.beam.run \
  --project-name my-first-test \
  --backend cloud \
  --mem0-api-key $MEM0_API_KEY \
  --chat-sizes 100K --conversations 0-9
```

### Option B: Mem0 OSS (Self-Hosted)

Requires Docker and Docker Compose. This starts a local Mem0 server backed by Qdrant.

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

docker compose up -d
# Mem0 server: http://localhost:8888
# Qdrant:      http://localhost:6333
```

Then run benchmarks against your local server:

```bash
# LOCOMO (fastest — ~300 questions, 10 conversations)
python -m benchmarks.locomo.run --project-name my-first-test

# LongMemEval (500 questions)
python -m benchmarks.longmemeval.run --project-name my-first-test --all-questions

# BEAM (configurable size)
python -m benchmarks.beam.run --project-name my-first-test --chat-sizes 100K --conversations 0-9
```

By default, the OSS server uses OpenAI for fact extraction (`gpt-4o-mini`) and embeddings (`text-embedding-3-small`). See [Custom Models](#custom-models) for using Azure, Ollama, or other providers.

### View results in the UI

```bash
npm install
npm run dev -- -p 3001
# Open http://localhost:3001
```

The web UI lets you browse results, inspect per-question evaluations with retrieval details, view logs, and compare runs.

## How It Works

Each benchmark script runs a three-stage pipeline:

```
Ingest → Search → Evaluate
```

1. **Ingest**: Conversations are chunked and added to Mem0. The system extracts facts, embeds them, and builds entity links.
2. **Search**: For each question, the system queries Mem0. Results are scored using semantic similarity + BM25 + entity boost.
3. **Evaluate**: An LLM generates an answer from retrieved memories, then a judge LLM scores correctness against ground truth.

## Configuration

### Benchmark options

All benchmarks accept these common flags:

```
--project-name NAME        Run identifier (required)
--answerer-model MODEL     LLM for answer generation (default: gpt-4o)
--judge-model MODEL        LLM for judging (default: gpt-4o)
--provider PROVIDER        LLM provider: openai, anthropic, azure (default: openai)
--top-k N                  Retrieved memories count (default: 200)
--top-k-cutoffs LIST       Evaluate at multiple cutoffs (default: 10,20,50,200)
--predict-only             Stop after search, skip answer+judge
--evaluate-only            Skip ingest+search, evaluate existing results
--resume                   Resume from checkpoint
--backend oss|cloud        Mem0 backend (default: oss)
--mem0-host URL            Mem0 server URL (default: http://localhost:8888)
```

### Custom Models

By default, the Mem0 server uses OpenAI for fact extraction (`gpt-4o-mini`) and embeddings (`text-embedding-3-small`). You can change this by mounting a custom config file.

**Step 1**: Copy an example config:

```bash
cp configs/azure-openai.yaml mem0-config.yaml
# or: cp configs/ollama.yaml mem0-config.yaml
```

**Step 2**: Edit `mem0-config.yaml` with your model details.

**Step 3**: Uncomment the volume mount in `docker-compose.yml`:

```yaml
volumes:
  - mem0_history:/app/history
  - ./mem0-config.yaml:/app/config.yaml:ro   # <-- uncomment this line
```

**Step 4**: Restart:

```bash
docker compose down && docker compose up -d
```

See `configs/` for examples:
- `configs/openai.yaml` — OpenAI (default)
- `configs/azure-openai.yaml` — Azure OpenAI
- `configs/ollama.yaml` — Fully local with Ollama (no API keys)

## Results

### Mem0 Platform

Results using the Mem0 managed platform with the v3 memory pipeline.

#### LongMemEval

| Metric | Top 200 | Top 50 |
|--------|---------|--------|
| **Overall** | **94.4%** (472/500) | **94.8%** (474/500) |

<details>
<summary>LongMemEval breakdown by question type</summary>

| Question Type | Top 200 | Top 50 |
|---------------|---------|--------|
| knowledge-update | 93.6% (73/78) | 93.6% (73/78) |
| multi-session | 88.0% (117/133) | 93.2% (124/133) |
| single-session-assistant | 98.2% (55/56) | 98.2% (55/56) |
| single-session-preference | 96.7% (29/30) | 93.3% (28/30) |
| single-session-user | 98.6% (69/70) | 98.6% (69/70) |
| temporal-reasoning | 97.0% (129/133) | 94.0% (125/133) |

</details>

#### LoCoMo

| Metric | Top 200 | Top 50 |
|--------|---------|--------|
| **Overall** | **92.5%** (1425/1540) | **91.8%** (1414/1540) |

<details>
<summary>LoCoMo breakdown by question type (avg across top_10/20/50/200)</summary>

| Question Type | Avg (Top 10–200) |
|---------------|------------------|
| single-hop | 91.2% |
| multi-hop | 91.3% |
| open-domain | 72.7% |
| temporal | 92.0% |

</details>

#### BEAM

| Dataset | Top 200 | | Top 50 | |
|---------|---------|---|--------|---|
| | **Pass Rate** | **Avg Score** | **Pass Rate** | **Avg Score** |
| **BEAM 1M** (700 questions) | **70.1%** (491/700) | 0.641 | **67.1%** (470/700) | 0.604 |
| **BEAM 10M** (200 questions) | **50.5%** (101/200) | 0.486 | **45.5%** (91/200) | 0.413 |

<details>
<summary>BEAM breakdown by memory ability type</summary>

**BEAM 1M (Top 200)**

| Ability | Avg Score | Pass Rate |
|---------|-----------|-----------|
| preference_following | 0.883 | 68/70 |
| instruction_following | 0.852 | 62/70 |
| information_extraction | 0.700 | 53/70 |
| multi_session_reasoning | 0.652 | 52/70 |
| knowledge_update | 0.650 | 46/70 |
| summarization | 0.635 | 48/70 |
| temporal_reasoning | 0.618 | 47/70 |
| event_ordering | 0.536 | 42/70 |
| abstention | 0.525 | 39/70 |
| contradiction_resolution | 0.357 | 34/70 |

**BEAM 10M (Top 200)**

| Ability | Avg Score | Pass Rate |
|---------|-----------|-----------|
| preference_following | 0.904 | 19/20 |
| instruction_following | 0.825 | 18/20 |
| knowledge_update | 0.750 | 16/20 |
| information_extraction | 0.562 | 11/20 |
| summarization | 0.469 | 11/20 |
| abstention | 0.400 | 8/20 |
| contradiction_resolution | 0.325 | 5/20 |
| multi_session_reasoning | 0.261 | 6/20 |
| event_ordering | 0.202 | 3/20 |
| temporal_reasoning | 0.163 | 4/20 |

</details>

### OSS with Different Extraction Models

LongMemEval results using the self-hosted Mem0 OSS pipeline with different LLMs for memory extraction. All runs use the same embedder (Qwen 600M via SageMaker), the same Qdrant vector store, and GPT-5 as the answerer and judge.

| Extraction Model | Overall | SS-User | SS-Asst | SS-Pref | Knowledge Update | Temporal Reasoning | Multi-Session |
|-----------------|---------|---------|---------|---------|------------------|-------------------|---------------|
| **GPT-5** | **91.0%** | 95.7% | 92.9% | 93.3% | 91.0% | 94.7% | 83.5% |
| **GPT-OSS-120B** | **89.8%** | 95.7% | 96.4% | 93.3% | 89.5% | 80.5% | 79.7% |
| **Llama 4 Maverick** | **88.6%** | 97.1% | 75.0% | 93.3% | 93.6% | 90.2% | 84.2% |
| **Gemma 4 31B** | **88.6%** | 95.7% | 83.9% | 93.3% | 94.9% | 91.7% | 78.9% |

Full per-question evaluation results are available in [`results/platform/`](results/platform/) and [`results/oss/`](results/oss/).

## A Note on Benchmark Scores

**Benchmark scores are not absolute numbers.** They depend heavily on:

- **Embedding model quality** — A larger, more capable embedding model will produce better retrieval, directly improving scores. The default `text-embedding-3-small` (1536 dims) is cost-efficient but not state-of-the-art.
- **LLM capability** — Both the fact extraction model (used during ingestion) and the judge model (used during evaluation) affect results. A stronger extraction model captures more nuanced facts; a stronger judge is more accurate in its verdicts.
- **Retrieval depth** — Higher `top-k` values give the system more chances to find relevant memories, but may also introduce noise.

When comparing configurations, keep all other variables constant and change only what you're testing. The default OpenAI setup provides a reproducible baseline — your scores will likely improve with stronger models.

## Project Structure

```
memory-benchmarks/
├── benchmarks/              Python evaluation scripts
│   ├── common/              Shared: Mem0 client, LLM client, metrics, utils
│   ├── locomo/              LOCOMO benchmark
│   ├── longmemeval/         LongMemEval benchmark
│   └── beam/                BEAM benchmark
├── configs/                 Example Mem0 server configs
├── docker/mem0/             Mem0 server (Dockerfile + FastAPI app)
├── docker-compose.yml       One-command setup: Mem0 + Qdrant
├── src/                     Next.js frontend
│   ├── app/                 Pages + API routes
│   ├── components/          UI components
│   └── lib/                 Database, adapters, executor
├── results/                 Benchmark output (gitignored)
└── datasets/                Auto-downloaded datasets (gitignored)
```

## License

Apache 2.0
