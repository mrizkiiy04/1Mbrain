# MD Page Ingestion untuk Memory Agent Extension

> Tujuan: menambahkan kemampuan seperti `.MD this page` ke ekstensi memory agent, agar halaman web dapat diubah menjadi Markdown, diekstrak menjadi fakta, disimpan sebagai memory, lalu dipanggil kembali melalui semantic search.

---

## 1. Prinsip Utama

Jangan langsung menyimpan seluruh halaman sebagai satu memory besar.

Workflow yang lebih aman:

```txt
Active Web Page
  ↓
Extract readable HTML
  ↓
Convert to clean Markdown
  ↓
Normalize + deduplicate
  ↓
Chunking
  ↓
Extract factual claims
  ↓
Validate / score confidence
  ↓
POST /v1/memories
  ↓
Embedding + vector DB
  ↓
Recall via semantic search
  ↓
Inject recalled context ke AI Agent
```

Kenapa tidak langsung simpan semua Markdown?

Karena halaman web sering berisi:
- iklan,
- navbar,
- footer,
- rekomendasi artikel,
- komentar,
- konten duplikat,
- klaim yang belum tentu faktual,
- dan teks yang terlalu panjang untuk memory retrieval.

Memory agent sebaiknya menyimpan **fakta terstruktur**, bukan sekadar “dump halaman”.

---

## 2. Modul yang Perlu Ditambahkan ke Extension

Struktur folder yang disarankan:

```txt
extension/
  manifest.json
  src/
    background.ts
    content/
      mdExtractor.ts
    ingest/
      markdownCleaner.ts
      chunker.ts
      factExtractor.ts
      memoryClient.ts
      sourceLedger.ts
    agent/
      contextInjector.ts
```

---

## 3. Manifest Permission

Tambahkan permission minimal:

```json
{
  "manifest_version": 3,
  "name": "Memory Agent",
  "version": "0.1.0",
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "contextMenus"
  ],
  "host_permissions": [
    "http://localhost:3001/*",
    "https://your-memory-api.com/*"
  ],
  "background": {
    "service_worker": "src/background.js",
    "type": "module"
  },
  "commands": {
    "ingest-page-to-memory": {
      "suggested_key": {
        "default": "Alt+M"
      },
      "description": "Convert this page to Markdown and store factual memory"
    }
  }
}
```

---

## 4. Background Workflow

```ts
// src/background.ts

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ingest-page-to-memory",
    title: "Remember this page as Memory",
    contexts: ["page", "selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "ingest-page-to-memory") {
    await chrome.tabs.sendMessage(tab.id, {
      action: "INGEST_PAGE_TO_MEMORY",
      selectionText: info.selectionText || null
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "ingest-page-to-memory") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await chrome.tabs.sendMessage(tab.id, {
    action: "INGEST_PAGE_TO_MEMORY"
  });
});
```

---

## 5. Extract Halaman menjadi Markdown

Gunakan library seperti:

```bash
npm install @mozilla/readability jsdom turndown
```

Atau gunakan pendekatan Defuddle/Turndown jika kamu ingin mirip `.MD this page`.

```ts
// src/content/mdExtractor.ts

import TurndownService from "turndown";

export type ExtractedMarkdownPage = {
  title: string;
  url: string;
  markdown: string;
  textContent: string;
  capturedAt: string;
  sourceHash: string;
};

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function extractCurrentPageMarkdown(): Promise<ExtractedMarkdownPage> {
  const title = document.title || "";
  const url = location.href;

  // Clone document supaya tidak merusak halaman aktif.
  const clone = document.cloneNode(true) as Document;

  // Hapus elemen yang biasanya noise.
  clone
    .querySelectorAll("script, style, nav, footer, aside, iframe, noscript")
    .forEach((el) => el.remove());

  const main =
    clone.querySelector("article") ||
    clone.querySelector("main") ||
    clone.body;

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced"
  });

  const markdown = turndown.turndown(main.innerHTML);
  const textContent = main.textContent?.replace(/\s+/g, " ").trim() || "";

  return {
    title,
    url,
    markdown,
    textContent,
    capturedAt: new Date().toISOString(),
    sourceHash: await sha256(url + "::" + textContent)
  };
}
```

---

## 6. Clean Markdown

```ts
// src/ingest/markdownCleaner.ts

export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(#.*?\)/g, "$1")
    .replace(/Subscribe to.*?\n/gi, "")
    .replace(/Sign up.*?\n/gi, "")
    .trim();
}
```

---

## 7. Chunking

Chunking penting agar semantic search lebih presisi.

```ts
// src/ingest/chunker.ts

export type MarkdownChunk = {
  index: number;
  content: string;
};

export function chunkMarkdown(markdown: string, maxChars = 1800): MarkdownChunk[] {
  const paragraphs = markdown.split(/\n\s*\n/g);
  const chunks: MarkdownChunk[] = [];

  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > maxChars && current.length > 0) {
      chunks.push({ index: chunks.length, content: current.trim() });
      current = paragraph;
    } else {
      current += "\n\n" + paragraph;
    }
  }

  if (current.trim()) {
    chunks.push({ index: chunks.length, content: current.trim() });
  }

  return chunks;
}
```

---

## 8. Fact Extraction Gate

Inilah bagian paling penting. Agent tidak boleh menyimpan semua kalimat sebagai fakta.

Gunakan LLM kecil/murah atau rules extractor untuk mengubah chunk menjadi JSON facts.

Prompt sistem:

```txt
You are a factual memory extractor.

Extract only stable, factual, reusable information from the provided Markdown chunk.

Rules:
- Do not store ads, navigation text, opinions, hype, or duplicated text.
- Do not invent facts.
- Every memory must include direct evidence from the source chunk.
- If the chunk contains no useful factual memory, return an empty array.
- Prefer concise claims.
- Classify memory type as: semantic, episodic, procedural, preference, entity, warning.
```

Expected JSON output:

```json
{
  "facts": [
    {
      "claim": "1MBrain supports SQLite with sqlite-vec and PostgreSQL with pgvector as storage backends.",
      "type": "semantic",
      "importance": 0.78,
      "confidence": 0.92,
      "tags": ["1mbrain", "storage", "vector-db"],
      "evidence": "SQLite + sqlite-vec ... PostgreSQL + pgvector",
      "shouldRemember": true
    }
  ]
}
```

---

## 9. Memory Client

Sesuaikan dengan API memory agent kamu.

```ts
// src/ingest/memoryClient.ts

export type MemoryInput = {
  content: string;
  type: "semantic" | "episodic" | "procedural" | "preference" | "entity" | "warning";
  importance: number;
  tags: string[];
  metadata: Record<string, unknown>;
};

export async function rememberMemory(input: MemoryInput) {
  const apiUrl = await getStorageValue("MEMORY_API_URL", "http://localhost:3001");
  const apiKey = await getStorageValue("MEMORY_API_KEY", "");
  const agentId = await getStorageValue("AGENT_ID", "browser-memory-agent");

  const res = await fetch(`${apiUrl}/v1/memories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Agent-Id": agentId
    },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    throw new Error(`Failed to store memory: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function getStorageValue<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}
```

---

## 10. Full Ingestion Handler

```ts
// src/content/index.ts

import { extractCurrentPageMarkdown } from "./mdExtractor";
import { cleanMarkdown } from "../ingest/markdownCleaner";
import { chunkMarkdown } from "../ingest/chunker";
import { rememberMemory } from "../ingest/memoryClient";
import { extractFactsFromChunk } from "../ingest/factExtractor";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== "INGEST_PAGE_TO_MEMORY") return;

  (async () => {
    const page = await extractCurrentPageMarkdown();
    const clean = cleanMarkdown(page.markdown);
    const chunks = chunkMarkdown(clean);

    let storedCount = 0;

    for (const chunk of chunks) {
      const facts = await extractFactsFromChunk({
        title: page.title,
        url: page.url,
        chunkIndex: chunk.index,
        markdown: chunk.content
      });

      for (const fact of facts) {
        if (!fact.shouldRemember || fact.confidence < 0.75) continue;

        await rememberMemory({
          content: fact.claim,
          type: fact.type,
          importance: fact.importance,
          tags: [
            ...fact.tags,
            "source:web-page",
            `domain:${new URL(page.url).hostname}`
          ],
          metadata: {
            sourceTitle: page.title,
            sourceUrl: page.url,
            sourceHash: page.sourceHash,
            capturedAt: page.capturedAt,
            chunkIndex: chunk.index,
            evidence: fact.evidence,
            confidence: fact.confidence,
            ingestionMode: "markdown-page"
          }
        });

        storedCount++;
      }
    }

    sendResponse({
      ok: true,
      title: page.title,
      url: page.url,
      chunks: chunks.length,
      storedCount
    });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});
```

---

## 11. Source Ledger untuk Anti-Halusinasi dan Deduplication

Sebelum menyimpan memory, cek apakah `sourceHash` sudah pernah diingest.

```ts
export async function hasSeenSource(sourceHash: string): Promise<boolean> {
  const key = `source:${sourceHash}`;
  const result = await chrome.storage.local.get(key);
  return Boolean(result[key]);
}

export async function markSourceAsSeen(sourceHash: string, data: unknown) {
  const key = `source:${sourceHash}`;
  await chrome.storage.local.set({
    [key]: {
      ...data,
      storedAt: new Date().toISOString()
    }
  });
}
```

---

## 12. Context Injection ke Agent

Saat user bertanya, agent jangan memakai semua memory. Lakukan recall dulu.

```ts
// src/agent/contextInjector.ts

export async function buildMemoryContext(userQuery: string) {
  const apiUrl = await getStorageValue("MEMORY_API_URL", "http://localhost:3001");
  const apiKey = await getStorageValue("MEMORY_API_KEY", "");
  const agentId = await getStorageValue("AGENT_ID", "browser-memory-agent");

  const url = new URL(`${apiUrl}/v1/memories/search`);
  url.searchParams.set("q", userQuery);
  url.searchParams.set("limit", "8");
  url.searchParams.set("maxHops", "2");
  url.searchParams.set("blendWeight", "0.35");

  const res = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      "X-Agent-Id": agentId
    }
  });

  if (!res.ok) throw new Error(`Recall failed: ${res.status}`);

  const results = await res.json();

  return [
    "## Relevant Memory Context",
    "",
    "Use these memories only when relevant. Prefer source-backed facts.",
    "",
    ...results.map((r: any, i: number) => {
      const m = r.memory;
      return [
        `### Memory ${i + 1}`,
        `- Content: ${m.content}`,
        `- Score: ${r.score}`,
        `- Type: ${m.type}`,
        `- Tags: ${(m.tags || []).join(", ")}`,
        `- Source: ${m.metadata?.sourceUrl || "unknown"}`,
        `- Evidence: ${m.metadata?.evidence || "not provided"}`
      ].join("\n");
    })
  ].join("\n");
}
```

---

## 13. Jangan Simpan Memory Ini

Buat filter keras agar memory agent tidak menjadi sampah.

Jangan simpan:
- klaim tanpa evidence,
- iklan,
- CTA,
- kalimat promosi,
- komentar pengguna random,
- halaman login,
- data sensitif,
- token/API key,
- password,
- alamat pribadi,
- isi email pribadi,
- session cookie,
- halaman bank/payment,
- konten yang belum selesai dimuat.

Contoh filter:

```ts
export function shouldRejectMemory(text: string): boolean {
  const lowered = text.toLowerCase();

  const blocked = [
    "subscribe",
    "sign up",
    "cookie policy",
    "privacy policy",
    "advertisement",
    "sponsored",
    "login",
    "password",
    "api key",
    "secret key",
    "credit card"
  ];

  return blocked.some((item) => lowered.includes(item));
}
```

---

## 14. Memory Schema yang Disarankan

```ts
type BrowserPageMemory = {
  content: string;
  type: "semantic" | "episodic" | "procedural" | "entity" | "warning";
  importance: number;
  tags: string[];
  metadata: {
    sourceTitle: string;
    sourceUrl: string;
    sourceDomain: string;
    sourceHash: string;
    capturedAt: string;
    chunkIndex: number;
    evidence: string;
    confidence: number;
    ingestionMode: "markdown-page";
    extractorVersion: string;
  };
};
```

---

## 15. Minimal MVP Roadmap

### Phase 1 — Manual Ingest
- Klik kanan halaman.
- Convert ke Markdown.
- Tampilkan preview.
- User klik “Save to Memory”.

### Phase 2 — Fact Extraction
- Chunk Markdown.
- Extract factual claims.
- User bisa approve/reject facts.

### Phase 3 — Auto Semantic Memory
- Simpan facts dengan confidence tinggi otomatis.
- Low confidence masuk review queue.

### Phase 4 — Agent Context Injection
- Saat user chat, agent melakukan recall.
- Memory relevan diinjeksi ke system/developer context.

### Phase 5 — Brain Dashboard
- Memory baru memicu event.
- Node baru muncul di dashboard.
- Association graph aktif.

---

## 16. Kesimpulan Implementasi

Ya, fitur seperti `.MD this page` sangat mungkin dimasukkan ke memory agent extension.

Namun desain yang benar bukan:

```txt
HTML → Markdown → langsung simpan
```

Melainkan:

```txt
HTML → Markdown → Clean → Chunk → Extract Facts → Validate → Remember → Embed → Recall → Inject Context
```

Dengan begitu, memory agent kamu tidak hanya “menyimpan halaman”, tetapi benar-benar membangun otak semantik yang bisa dicari, dihubungkan, dan dipakai ulang oleh AI agent.
