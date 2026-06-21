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
import { ingestUrl } from '@1mbrain/ingest';
import { getDefaultLedger } from '@1mbrain/ingest';
import type { AuthContext } from '../middleware/auth.js';

type Env = {
  Variables: {
    auth: AuthContext;
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

export function createIngestRoutes(apiUrl: string, apiKey: string) {
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
    const agentId = parsed.data.agentId ?? auth.agentId;

    // Run pipeline (non-blocking from route's perspective — but we await result)
    const result = await ingestUrl(url, {
      agentId,
      apiUrl,
      apiKey,
      confidenceThreshold,
      maxChunkChars,
      deduplicateByHash: deduplicate,
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

  app.get('/status/:sourceHash', async (c) => {
    const sourceHash = c.req.param('sourceHash');

    if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
      throw new HTTPException(400, { message: 'sourceHash must be a 64-character hex string' });
    }

    const ledger = getDefaultLedger();
    const entry = await ledger.getEntry(sourceHash);

    if (!entry) {
      return c.json({ success: true, data: { seen: false } });
    }

    return c.json({
      success: true,
      data: {
        seen: true,
        url: entry.url,
        title: entry.title,
        storedAt: entry.storedAt,
        factCount: entry.factCount,
      },
    });
  });

  return app;
}
