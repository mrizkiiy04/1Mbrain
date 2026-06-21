# 1MBrain

> A portable, holographic memory layer for any AI agent.

[![NPM Version](https://img.shields.io/npm/v/@1mbrain/sdk.svg)](https://www.npmjs.com/package/@1mbrain/sdk)
[![PyPI Version](https://img.shields.io/pypi/v/onemillionbrain.svg)](https://pypi.org/project/onemillionbrain/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

*Scroll down for Bahasa Indonesia.*

---

## What is 1MBrain?

1MBrain is a framework-agnostic **infrastructure layer for AI agent memory**. Any agent (Claude, GPT, LangChain, LlamaIndex, CrewAI, AutoGen) or gateway interface (Telegram/Discord bots, custom scripts) can call 1MBrain's API to **remember**, **recall**, and **forget**, instead of reinventing ad-hoc memory storage.

By utilizing the **Agent ID Namespace**, you can partition memories completely. This allows a single 1MBrain instance to serve multiple agents, bots, or individual chat users concurrently.

### 🌟 Key Features

| Feature | Description |
| --- | --- |
| **Associative Retrieval** | Connects memories in a graph with spreading activation, surfacing related memories beyond standard cosine similarity bounds. |
| **Time-Aware Supersedence** | Engine automatically tracks chronological state updates, suppressing stale memories using an Ebbinghaus decay curve without deleting historical data. |
| **Automated Web-to-MD Ingest** | Built-in pipeline (`packages/ingest`) that fetches URLs, extracts readable content, and converts to Markdown. |
| **Pulse Brain Dashboard** | Real-time network graph visualization of active memory nodes. |
| **Memory Passport** | Encrypted export and import of memory states between agents with Google Drive backup integration. |

---

## 🚀 Installation & Quick Start

1MBrain supports seamless integration in both TypeScript/Node.js and Python ecosystems.

### TypeScript / Node.js SDK

Install the official NPM package:
```bash
npm install @1mbrain/sdk
```

**Usage:**
```ts
import { OneMBrainClient } from '@1mbrain/sdk';

const brain = new OneMBrainClient({
  apiUrl: 'http://localhost:3100',
  apiKey: 'your-api-key',
  agentId: 'my-assistant-bot', // Namespace for isolation
});

// Store a memory
await brain.remember({
  type: 'semantic',
  content: 'User prefers dark mode UI',
  importance: 0.9,
  tags: ['preference', 'ui']
});

// Recall with graph traversal
const results = await brain.recall({
  query: 'what is the user UI preference?',
  limit: 5,
  useSpreadingActivation: true
});
```

### Python SDK

Install the official PyPI package:
```bash
pip install onemillionbrain
```

**Usage:**
```python
from onemillionbrain import OneMBrainClient
import asyncio

async def main():
    brain = OneMBrainClient(
        api_url="http://localhost:3100",
        api_key="your-api-key",
        agent_id="my-assistant-bot"
    )

    await brain.remember(
        type="semantic",
        content="User prefers Python for data engineering",
        importance=0.9,
        tags=["preference", "language"]
    )

    results = await brain.recall(
        query="what programming language does the user prefer?",
        limit=5,
        use_spreading_activation=True
    )
    print(results)

asyncio.run(main())
```

### Self-Hosting the Server

To host your own 1MBrain API server and dashboard:

1. **Clone & Install**
   ```bash
   git clone https://github.com/stolenhourdev/1mbrain.git
   cd 1mbrain
   npm install
   ```
2. **Configure & Start Redis**
   ```bash
   cp .env.example .env
   docker compose up -d
   ```
3. **Start API Server & Dashboard**
   ```bash
   npm run dev            # API runs on port 3100
   npm run dev:dashboard  # Dashboard runs on port 3200
   ```

---

## 📊 Performance & Benchmarks

1MBrain features an advanced graph-based ranking algorithm that aggressively penalizes stale memories and entity distractors. 

Based on the latest rigorous `memory-bench-realistic-medium` evaluation using OpenAI Judge:

| Provider | Evidence Accuracy | Recall@5 | MRR |
|---|---:|---:|---:|
| **1MBrain Graph Full** | **74.4%** | **89.4%** | **0.727** |
| 1MBrain Graph Light | 74.4% | 89.4% | 0.727 |
| 1MBrain Vector Only | 72.6% | 91.0% | 0.726 |
| Vector Baseline (SQLite) | 61.9% | 75.7% | 0.557 |

**Conclusion:** 
1MBrain Graph Full outperforms standard Vector-only baseline by over **20%** in evidence retrieval accuracy, particularly excelling in **Multi-hop reasoning** scenarios.

---
---

# 🇮🇩 Bahasa Indonesia

> Lapisan memori holografis portabel untuk berbagai AI agent.

## Apa itu 1MBrain?

1MBrain adalah infrastruktur memori yang tidak terikat pada framework spesifik. Baik Anda menggunakan agen AI seperti Claude, GPT, LangChain, atau sekadar antarmuka *gateway* seperti bot Telegram/Discord, Anda dapat langsung memanggil API 1MBrain untuk menyimpan (**remember**), mengingat (**recall**), dan melupakan (**forget**) konteks, alih-alih membangun database secara manual.

Setiap memori diisolasi penuh melalui **Agent ID Namespace**, sehingga satu server 1MBrain dapat melayani puluhan atau ratusan bot/pengguna secara mandiri dan aman.

### 🌟 Fitur Utama

- **Associative Retrieval:** Menghubungkan memori dalam struktur *graph* melalui *spreading activation*, sehingga informasi yang saling terkait bisa diambil secara akurat walaupun secara vektor kosinus tidak terlalu mirip.
- **Time-Aware Supersedence:** Sistem otomatis menekan memori *stale* (kadaluarsa) saat ada informasi terbaru, tanpa harus menghapus riwayat masa lalu (menggunakan kurva Ebbinghaus decay).
- **Pulse Brain Dashboard:** Visualisasi jaring *graph* memori Anda secara *real-time*.
- **Memory Passport:** Ekspor dan impor kondisi memori antar-agen dengan dukungan enkripsi tangguh serta pencadangan (*backup*) ke Google Drive.

## 🚀 Instalasi & Penggunaan

### Menggunakan TypeScript/Node.js (NPM)
```bash
npm install @1mbrain/sdk
```

### Menggunakan Python (PyPI)
```bash
pip install onemillionbrain
```

*(Silakan merujuk ke blok kode pada bagian bahasa Inggris di atas untuk contoh implementasi kodenya).*

## 📊 Tolok Ukur Kinerja (Benchmark)

1MBrain memiliki arsitektur penyaringan *stale memory* dan *distractor* yang ketat. Pada uji coba terbaru yang dinilai oleh *OpenAI Judge* (dengan dataset realistis tingkat menengah):

- **1MBrain Graph Full** memimpin dengan akurasi pengambilan bukti mencapai **74.4%** dan rasio Recall@5 **89.4%**.
- Algoritma *Graph Traversal* kami mengalahkan metode *baseline* vektor konvensional (SQLite) dengan margin **>20%** khususnya untuk kueri-kueri sulit yang membutuhkan pemikiran *multi-hop*.

---
## Lisensi
MIT License. Silakan lihat [LICENSE](LICENSE) untuk detail.

Dibangun dengan 💙 oleh [stolenhourdev](https://www.threads.com/@stolenhourdev)
