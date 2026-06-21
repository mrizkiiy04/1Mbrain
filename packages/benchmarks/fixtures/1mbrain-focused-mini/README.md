# 1MBrain Focused Mini Benchmark

This fixture is a small, GitHub-friendly benchmark dataset for evaluating memory-system
behavior before running large external suites such as LOCOMO.

It is designed to keep API usage low:

- 5 conversations
- 40 turns
- 41 memory records
- 23 questions
- Deterministic expected answers
- Explicit required and forbidden memory IDs
- No LLM judge required for retrieval metrics

## What It Tests

- Atomic fact recall
- Temporal updates and "latest wins" behavior
- Multi-hop association recall
- Contradiction resolution
- Paraphrase recall with weak keyword overlap
- Procedural memory
- Noise resistance
- Portability/export-import preservation
- Context injection suitability

## Recommended Metrics

- `Recall@5`
- `Recall@10`
- `MRR@10`
- `NDCG@10`
- `Forbidden hit rate`
- `Temporal correctness`
- `Multi-hop completeness`
- `Passport preservation rate`

## File

- `1mbrain-focused-mini.json`

The fixture stores natural conversation turns and a canonical `memory_records` list.
Benchmark runners should ingest `memory_records`, optionally create `associations`,
then run the listed questions.
