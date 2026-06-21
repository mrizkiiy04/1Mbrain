# 1MBrain — Product Requirements Document

**Tagline:** *A portable, holographic memory layer for any AI agent.*
**Status:** Draft v1.0
**Owner:** mrizkiiy04 - stolenhourdev
**Target repo:** `soon`

---

## 1. Overview

1MBrain is a memory provider for AI agents — an infrastructure layer, not a chatbot or mobile app. Any agent (Hermes, a Claude-based agent, a custom LangChain/LlamaIndex bot, or a hand-rolled script) can call 1MBrain's API to remember, recall, and forget, instead of every project reinventing its own ad-hoc memory store.

Three things differentiate it from a plain vector database wrapper:

1. **Associative ("holographic-inspired") retrieval** — memories aren't just nearest-neighbor lookups, they're connected in a graph that activates related memories the way a partial cue can surface a whole memory in human recall.
2. **Pulse Brain dashboard** — a live, visual representation of what an agent is "thinking about" right now, rendered as a pulsing node network rather than a log of database rows.
3. **Portability** — memory isn't locked into one agent or one vendor. It can be exported as a self-contained snapshot, backed up to Google Drive, and re-imported into a completely different agent.

## 2. Problem Statement

Most AI agents today either have no persistent memory (everything resets per session) or have memory tightly coupled to one framework's internal format. This creates three recurring pain points: memory is invisible (no way to inspect what an agent actually remembers), memory is trapped (switching agent frameworks means starting from zero), and memory degrades silently (no mechanism to see which memories are stale, contradictory, or never retrieved).

## 3. Goals & Non-Goals

**Goals**
- Provide a framework-agnostic API/SDK for agent memory (store, recall, associate, forget).
- Implement an associative retrieval layer that goes beyond plain cosine-similarity search.
- Ship a real-time visual dashboard (Pulse Brain) showing memory activity.
- Support full export/import of memory state ("Memory Passport") between agents.
- Support backup/restore to Google Drive.

**Non-Goals**
- Not a foundation model or an agent itself — 1MBrain has no reasoning loop of its own.
- Not a general document/RAG store for large static corpora (it can sit next to one, but that's a different problem).
- Not mobile-first; this is a backend service with a web dashboard.
- Not hosted-only — anyone cloning the GitHub repo must be able to run a complete, fully-functional instance on their own infrastructure with no mandatory dependency on a paid or centralized backend.

## 4. Target Users

The primary user is muhammad rizki as a vibecoder integrating 1MBrain into personal agent projects (Hermes and others). Secondary users are other indie developers and small teams building custom agents who want persistent, inspectable, portable memory without building it from scratch.

## 5. Core Concepts

### 5.1 Memory Types

| Type | Description | Example |
|---|---|---|
| Episodic | Timestamped record of a specific interaction or event | "User asked about VibeAman pricing on 2026-06-10" |
| Semantic | Durable fact or preference, decoupled from the moment it was learned | "User prefers Bahasa Indonesia as primary language" |
| Procedural | A learned pattern of how to do something | "When user says 'push to GitHub,' they mean create a PRD/markdown deliverable" |

### 5.2 Associative ("Holographic-Inspired") Retrieval

True Holographic Reduced Representations (Plate, 1995) encode memories as distributed vectors using circular convolution, so a partial cue can reconstruct an associated whole. It's elegant but computationally heavy and hard to debug in production.

1MBrain's fine-tuned approach keeps the spirit without the cost: every memory is stored as a standard embedding **plus** a node in a lightweight association graph. Edges between nodes are created from co-occurrence, semantic similarity above a threshold, or explicit agent-declared links. Retrieval works in two passes — a vector search finds the closest direct matches, then a spreading-activation pass walks the graph a few hops outward, surfacing related memories that wouldn't rank highly on embedding similarity alone. This is the practical "holographic improvement": distributed, associative recall behavior, built on infrastructure that's actually maintainable.

### 5.3 Pulse Brain Dashboard

A real-time visualization where each memory is a node and each association is an edge. Nodes pulse (glow/scale animation) when read or written, color-coded by memory type, with edge thickness representing association strength. It functions as a live EEG-style view into what an agent is recalling, not a static admin panel.

### 5.4 Memory Passport (Portability)

A versioned export format containing raw memory content (never just raw vectors, since embedding models differ between agents), metadata, importance/decay scores, and the association graph. Any agent implementing the 1MBrain client can import a passport, even if its embedding model differs from the exporting agent — content is re-embedded locally on import, while the graph structure and metadata carry over intact.

## 6. System Architecture

| Component | Responsibility |
|---|---|
| API Gateway | Auth, rate limiting, routing to Memory Engine |
| Memory Engine | Core read/write logic, decay scoring, spreading activation |
| Embedding Service | Pluggable adapter (OpenAI, Claude, local via Ollama) |
| Association Graph Store | Holds edges between memory nodes |
| Dashboard Server | WebSocket stream of live memory events to the Pulse Brain frontend |
| Backup Service | Google Drive connector for snapshot export/import |
| Client SDKs | Thin wrappers (`remember()`, `recall()`, `forget()`, `associate()`) per language/framework |

## 7. Recommended Tech Stack

- **Backend:** TypeScript on Hono (consistent with the VibeAman stack already in use), or Fastify if a more conventional Node setup is preferred.
- **Storage:** SQLite + `sqlite-vec` for self-hosted/lightweight deployments; PostgreSQL + `pgvector` if multi-agent/multi-tenant scale is needed.
- **Cache/pub-sub:** Redis, primarily to drive the dashboard's live WebSocket stream.
- **Dashboard frontend:** Next.js + D3 force-directed graph (2D, lighter) or Three.js (3D, more "brain-like"); start with D3, upgrade later if needed.
- **Auth:** Per-agent API keys, scoped to a namespace so multiple agents can't see each other's memory by default.
- **Backup:** Google Drive API v3 with OAuth2, storing encrypted snapshot files.

## 8. Data Model

**Memory**

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| agent_id | string | namespace/tenant |
| type | enum | episodic / semantic / procedural |
| content | text | raw, human-readable — the source of truth |
| embedding_model | string | which model generated the vector below |
| embedding | vector | nullable; regenerated on import if model mismatches |
| importance | float | 0–1, manually or heuristically scored |
| decay_score | float | drops over time without access, raises retrieval priority for review/pruning |
| created_at / last_accessed_at | timestamp | |
| tags | string[] | |

**Association**

| Field | Type | Notes |
|---|---|---|
| source_id / target_id | uuid | |
| strength | float | 0–1 |
| origin | enum | co-occurrence / similarity / explicit |

## 9. API Specification (high-level)

- `POST /v1/memories` — remember
- `GET /v1/memories/search?q=...` — recall (vector + spreading activation)
- `DELETE /v1/memories/:id` — forget
- `POST /v1/memories/:id/associate` — explicit link
- `POST /v1/export` — generate Memory Passport
- `POST /v1/import` — ingest a Memory Passport
- `POST /v1/backup/gdrive` — push snapshot to Drive
- `POST /v1/restore/gdrive` — pull snapshot from Drive
- `GET /v1/dashboard/stream` — WebSocket feed for Pulse Brain

## 10. Pulse Brain — Feature Detail

The dashboard subscribes to the WebSocket stream and renders memory nodes that brighten and pulse on access. Filters allow narrowing by agent, memory type, or time window, so a developer can watch one specific agent's recall behavior in isolation during debugging.

## 11. Backup & Portability — Feature Detail

Backups can run manually or on a schedule, exporting a Memory Passport and uploading it to a designated Google Drive folder with versioned filenames. Restoring rehydrates the full memory + association graph for the target agent. Cross-agent import follows the same path: a passport exported from Hermes can be imported into a different agent, with embeddings regenerated locally rather than assumed compatible.

## 12. Security & Privacy

API keys isolate memory by agent namespace by default. All traffic is encrypted in transit; snapshot exports are encrypted at rest before upload (AES-256). Self-hosting is a hard requirement, not an optional mode: the repo must ship with a working local setup (Docker Compose or equivalent) so anyone can run their own instance with no external service dependency beyond their chosen embedding provider. Google Drive backup is an optional add-on for self-hosters who want it, not a requirement to run the system.

## 13. Success Metrics

- Time to integrate a new agent against the API (target: under 30 minutes following the SDK quickstart).
- Recall relevance — qualitative spot-checks comparing pure vector search vs. spreading-activation results on the same query set.
- Dashboard event latency (write → visible pulse) under 200ms locally.
- Successful round-trip backup/restore and cross-agent import without data loss.

## 14. Roadmap

| Phase | Scope |
|---|---|
| 1 | Core Memory Engine + REST API, SQLite backend, single-agent use |
| 2 | Pulse Brain dashboard (read-only visualization over the WebSocket stream) |
| 3 | Google Drive backup/restore + Memory Passport export/import |
| 4 | Association graph + spreading-activation retrieval (the "holographic" layer) |
| 5 | Client SDKs for common frameworks + a Hermes-specific adapter |

## 15. Open Questions

- License for the GitHub release (MIT for max adoption vs. a more restrictive license if a hosted product is planned later).
- Standardizing on one default embedding model vs. fully pluggable from day one — pluggable is more flexible but adds import-time complexity.

## 16. Suggested Repository Structure

```
1mbrain/
├── packages/
│   ├── core/        # Memory Engine, association graph, spreading activation
│   ├── api/         # Hono server, REST + WebSocket routes
│   ├── dashboard/   # Next.js Pulse Brain frontend
│   └── sdk/         # Client libraries (TS, Python)
├── docs/
│   └── memory-passport-spec.md
└── README.md
```
