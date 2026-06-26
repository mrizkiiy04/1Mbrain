/**
 * Ingest Routes
 *
 * Gateway-agnostic endpoints for web page ingestion.
 * Any agent (Telegram, Discord, browser ext, CLI) can call these.
 *
 * POST /v1/ingest/url
 *   - Trigger full ingest pipeline for a URL
 *   - Returns IngestResult with storedCount, memoryIds, etc.
 *
 * GET  /v1/ingest/status/:sourceHash
 *   - Check if a URL hash has already been ingested
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { ingestUrl, ingestMarkdown } from '@1mbrain/ingest';
import type { IngestFactStore, IngestSourceStore } from '@1mbrain/ingest';
import type { DatabaseProvider, MemoryEngine } from '@1mbrain/core';
import type { AuthContext } from '../middleware/auth.js';

type Env = {
  Variables: {
    auth: AuthContext;
    engine: MemoryEngine;
    db: DatabaseProvider;
  };
};

// ─── Request validation ───────────────────────────────────

const IngestUrlSchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048),
  /** Override agent ID (defaults to authenticated agent) */
  agentId: z.string().min(1).max(128).optional(),
  /** Confidence threshold 0-1 (default 0.75) */
  confidenceThreshold: z.number().min(0).max(1).optional(),
  /** Max chunk size in chars (default 1800) */
  maxChunkChars: z.number().int().min(100).max(8000).optional(),
  /** Skip if already ingested (default true) */
  deduplicate: z.boolean().optional(),
});

// ─── Route factory ────────────────────────────────────────

export function createIngestRoutes() {
  const app = new Hono<Env>();

  // ── POST /v1/ingest/url ──────────────────────────────

  app.post('/url', async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json();

    const parsed = IngestUrlSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const { url, confidenceThreshold, maxChunkChars, deduplicate } = parsed.data;
    if (parsed.data.agentId && parsed.data.agentId !== auth.agentId && !auth.isMaster) {
      throw new HTTPException(403, { message: 'Cannot ingest into a different agent namespace' });
    }
    const agentId = parsed.data.agentId ?? auth.agentId;
    const engine = c.get('engine');
    const db = c.get('db');

    // Store facts directly through the server engine. This avoids recursive HTTP calls and
    // combines the durable source claim with deterministic fact identifiers for safe retries.
    const sourceStore: IngestSourceStore = {
      claim: async (input) => (await db.claimIngestionSource(input)).status,
      complete: async (input) => db.completeIngestionSource(input.agentId, input.sourceHash, input.storedCount),
      release: async (input) => db.releaseIngestionSource(input.agentId, input.sourceHash),
    };
    const factStore: IngestFactStore = {
      store: async (input) => {
        try {
          const memory = await engine.remember(input);
          return { id: memory.id, deduplicated: false };
        } catch (err) {
          const existing = await db.getMemoryById(input.id, input.agentId);
          if (existing) return { id: existing.id, deduplicated: true };
          throw err;
        }
      },
    };
    const result = await ingestUrl(url, {
      agentId,
      confidenceThreshold,
      maxChunkChars,
      deduplicateByHash: deduplicate,
      sourceStore,
      factStore,
    });

    if (!result.ok && !result.deduplicated) {
      throw new HTTPException(422, {
        message: result.error ?? 'Ingest pipeline failed',
      });
    }

    const statusCode = result.deduplicated ? 200 : result.storedCount > 0 ? 201 : 200;

    return c.json(
      {
        success: true,
        data: {
          title: result.title,
          url: result.url,
          sourceHash: result.sourceHash,
          chunkCount: result.chunkCount,
          extractedCount: result.extractedCount,
          storedCount: result.storedCount,
          skippedCount: result.skippedCount,
          errorCount: result.errorCount,
          deduplicated: result.deduplicated ?? false,
          memoryIds: result.memoryIds,
        },
      },
      statusCode,
    );
  });

  // ── GET /v1/ingest/status/:sourceHash ───────────────

  const IngestMarkdownSchema = z.object({ title: z.string().min(1).max(512), url: z.string().min(1).max(2048), markdown: z.string().min(1).max(1_000_000), agentId: z.string().min(1).max(128).optional(), confidenceThreshold: z.number().min(0).max(1).optional(), maxChunkChars: z.number().int().min(100).max(8000).optional(), deduplicate: z.boolean().optional() });

  app.post('/markdown', async (c) => {
    const auth = c.get('auth'); const parsed = IngestMarkdownSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
    if (parsed.data.agentId && parsed.data.agentId !== auth.agentId && !auth.isMaster) throw new HTTPException(403, { message: 'Cannot ingest into a different agent namespace' });
    const agentId = parsed.data.agentId ?? auth.agentId; const engine = c.get('engine'); const db = c.get('db');
    const sourceStore: IngestSourceStore = { claim: async (input) => (await db.claimIngestionSource(input)).status, complete: async (input) => db.completeIngestionSource(input.agentId, input.sourceHash, input.storedCount), release: async (input) => db.releaseIngestionSource(input.agentId, input.sourceHash) };
    const factStore: IngestFactStore = { store: async (input) => { try { const memory = await engine.remember(input); return { id: memory.id, deduplicated: false }; } catch (err) { const existing = await db.getMemoryById(input.id, input.agentId); if (existing) return { id: existing.id, deduplicated: true }; throw err; } } };
    const result = await ingestMarkdown({ ...parsed.data, agentId, sourceStore, factStore, deduplicateByHash: parsed.data.deduplicate });
    if (!result.ok) throw new HTTPException(422, { message: result.error ?? 'Ingest pipeline failed' });
    return c.json({ success: true, data: result }, result.deduplicated ? 200 : result.storedCount > 0 ? 201 : 200);
  });
  app.get('/status/:sourceHash', async (c) => {
    const sourceHash = c.req.param('sourceHash');

    if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
      throw new HTTPException(400, { message: 'sourceHash must be a 64-character hex string' });
    }

    const source = await c.get('db').getIngestionSource(c.get('auth').agentId, sourceHash);

    if (!source || source.status !== 'completed') {
      return c.json({ success: true, data: { seen: false } });
    }

    return c.json({
      success: true,
      data: {
        seen: true,
        url: source.url,
        title: source.title,
        storedAt: source.completedAt?.toISOString(),
        factCount: source.storedCount,
      },
    });
  });

  return app;
}
