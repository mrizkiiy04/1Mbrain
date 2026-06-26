/**
 * API Route Tests
 *
 * HTTP-level integration tests for the Hono server routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { MemoryEngine, SqliteDatabaseProvider, InMemoryEventBus } from '@1mbrain/core';
import type { EmbeddingProvider } from '@1mbrain/core';
import { createMemoryRoutes } from '../src/routes/memories.js';
import { createPassportRoutes } from '../src/routes/passport.js';
import { createBackupRoutes } from '../src/routes/backup.js';
import { createConsolidateRoutes } from '../src/routes/consolidate.js';
import { createIngestRoutes } from '../src/routes/ingest.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { setDefaultLLMClient } from '@1mbrain/ingest';

// ─── Mock Embedding Provider ────────────────────────────

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly model = 'mock-embed-v1';
  readonly dimensions = 4;

  async embed(_text: string): Promise<number[]> {
    return [0.1, 0.2, 0.3, 0.4];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
  }
}

// ─── Tests ──────────────────────────────────────────────

type TestEnv = {
  Variables: {
    engine: MemoryEngine;
    db: SqliteDatabaseProvider;
  };
};

describe('API Routes', () => {
  let app: Hono<TestEnv>;
  let engine: MemoryEngine;
  let db: SqliteDatabaseProvider;

  beforeEach(async () => {
    // Setup Engine with in-memory SQLite
    db = new SqliteDatabaseProvider(':memory:');
    await db.initialize();
    const eventBus = new InMemoryEventBus();
    const embedder = new MockEmbeddingProvider();

    engine = new MemoryEngine(db, embedder, eventBus);

    // Setup Hono App for testing
    process.env.MASTER_API_KEY = 'test-key';
    process.env.EXPORT_ENCRYPTION_KEY = 'test-export-key';
    process.env.GDRIVE_CLIENT_ID = 'gdrive-client-id';
    process.env.GDRIVE_CLIENT_SECRET = 'gdrive-client-secret';
    process.env.GDRIVE_REDIRECT_URI = 'http://localhost:3100/auth/gdrive/callback';
    process.env.GDRIVE_ACCESS_TOKEN = 'gdrive-access-token';
    process.env.GDRIVE_BACKUP_FOLDER_ID = 'folder-id';

    app = new Hono<TestEnv>();

    app.use('*', async (c, next) => {
      c.set('engine', engine);
      c.set('db', db);
      await next();
    });

    app.use('/v1/*', authMiddleware);
    app.route('/v1/memories', createMemoryRoutes());
    app.route(
      '/v1',
      createConsolidateRoutes({
        run: async (agentId: string) => ({
          agentId,
          triggerReason: 'threshold',
          dryRun: true,
          storedCount: 0,
          archivedCount: 0,
          clustersProcessed: 0,
          skipped: {
            noCandidates: 1,
            tooSmallClusters: 0,
            summarizationFailed: 0,
            dryRun: 0,
          },
          errors: [],
          summaryIds: [],
        }),
        preview: async (agentId: string) => ({
          agentId,
          candidateCount: 0,
          estimatedClusters: 0,
          estimatedLLMCalls: 0,
        }),
      }),
    );
    app.route('/v1', createPassportRoutes());
    app.route('/v1', createBackupRoutes());
    app.route('/v1/ingest', createIngestRoutes());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await engine.shutdown();
  });

  describe('Auth Middleware', () => {
    it('should reject requests without API key', async () => {
      const res = await app.request('/v1/memories/search?q=test', {
        method: 'GET',
      });

      expect(res.status).toBe(401);
      const data = await res.text();
      expect(data).toMatch(/Missing API key/);
    });

    it('should reject requests with invalid API key', async () => {
      const res = await app.request('/v1/memories/search?q=test', {
        method: 'GET',
        headers: {
          'X-API-Key': 'wrong-key',
        },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /v1/memories', () => {
    it('should create a memory and return 201', async () => {
      const res = await app.request('/v1/memories', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'semantic',
          content: 'The user loves testing.',
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();
      expect(data.data.content).toBe('The user loves testing.');
      expect(data.data.agentId).toBe('test-agent');
    });

    it('should fail validation with 400 for missing content', async () => {
      const res = await app.request('/v1/memories', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'semantic',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toBe('Validation failed');
    });
  });

  describe('POST /v1/ingest/markdown', () => {
    it('stores Markdown once and returns a durable deduplication result on retry', async () => {
      setDefaultLLMClient({
        chat: async () => ({
          content: JSON.stringify({ facts: [{ claim: 'The digest confirms a durable ingestion contract.', type: 'semantic', importance: 0.8, confidence: 0.95, tags: ['digest'], evidence: 'durable ingestion contract', shouldRemember: true }] }),
          finishReason: 'stop',
        }),
      } as any);
      const body = { title: 'Digest', url: 'urn:document:api-test', markdown: `# Digest
The first verified finding confirms that durable ingestion preserves source identity across retries.
The second verified finding records that server-side claims prevent concurrent duplicate processing.
The third verified finding explains that deterministic fact identifiers make partial retries safe.
The fourth verified finding states that trusted Markdown follows the same confidence gate as URL content.` };
      const headers = { 'X-API-Key': 'test-key', 'X-Agent-Id': 'test-agent', 'Content-Type': 'application/json' };

      const first = await app.request('/v1/ingest/markdown', { method: 'POST', headers, body: JSON.stringify(body) });
      expect(first.status).toBe(201);
      const firstData = await first.json() as any;
      expect(firstData.data.storedCount).toBe(1);

      const second = await app.request('/v1/ingest/markdown', { method: 'POST', headers, body: JSON.stringify(body) });
      expect(second.status).toBe(200);
      expect((await second.json() as any).data.deduplicated).toBe(true);
    });
  });

  describe('GET /v1/memories/search', () => {
    it('should search memories', async () => {
      // Seed a memory first
      await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'This is a test memory.',
      });

      const res = await app.request('/v1/memories/search?q=test+memory', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].memory.content).toBe('This is a test memory.');
    });
  });

  describe('DELETE /v1/memories/:id', () => {
    it('should delete an existing memory', async () => {
      const memory = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'To be deleted',
      });

      const res = await app.request(`/v1/memories/${memory.id}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);

      // Verify deletion
      const results = await engine.recall({
        agentId: 'test-agent',
        query: 'To be deleted',
        limit: 10,
        threshold: 0,
      });
      const found = results.find((r) => r.memory.id === memory.id);
      expect(found).toBeUndefined();
    });
  });

  describe('POST /v1/memories/:id/associate', () => {
    it('should store a typed association relation', async () => {
      const source = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Current project state',
      });
      const target = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Previous project state',
      });

      const res = await app.request(`/v1/memories/${source.id}/associate`, {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetId: target.id,
          strength: 0.9,
          origin: 'explicit',
          relationType: 'supersedes',
        }),
      });

      expect(res.status).toBe(200);
      const associations = await db.getAssociations(source.id);
      expect(associations.some((association) => association.relationType === 'supersedes')).toBe(true);
    });

    it('should reject associations outside the authenticated agent namespace', async () => {
      const source = await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Source memory',
      });
      const target = await engine.remember({
        agentId: 'other-agent',
        type: 'semantic',
        content: 'Other agent memory',
      });

      const res = await app.request(`/v1/memories/${source.id}/associate`, {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetId: target.id,
          strength: 0.9,
          origin: 'explicit',
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Memory Passport endpoints', () => {
    it('should export an encrypted passport envelope by default', async () => {
      await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Portable memory',
      });

      const res = await app.request('/v1/export', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.meta.encrypted).toBe(true);
      expect(data.data.format).toBe('1mbrain.passport.envelope');
      expect(data.data.payload).toBeTruthy();
      expect(data.data.payload).not.toContain('Portable memory');
    });

    it('should import an encrypted passport envelope', async () => {
      await engine.remember({
        agentId: 'source-agent',
        type: 'semantic',
        content: 'Encrypted portable memory',
      });

      const exportRes = await app.request('/v1/export', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'source-agent',
        },
      });
      const exported = (await exportRes.json()) as any;

      const importRes = await app.request('/v1/import', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'target-agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          envelope: exported.data,
          options: {
            targetAgentId: 'target-agent',
            conflictStrategy: 'skip',
          },
        }),
      });

      expect(importRes.status).toBe(200);
      const imported = (await importRes.json()) as any;
      expect(imported.success).toBe(true);
      expect(imported.data.imported).toBeGreaterThan(0);

      const results = await engine.recall({
        agentId: 'target-agent',
        query: 'Encrypted portable memory',
        limit: 5,
        threshold: 0,
        useSpreadingActivation: false,
      });

      expect(results.some((result) => result.memory.content === 'Encrypted portable memory')).toBe(
        true,
      );
    });
  });

  describe('Consolidation endpoints', () => {
    it('runs dry-run consolidation for the authenticated agent', async () => {
      const res = await app.request('/v1/consolidate', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dryRun: true,
          clusterStrategy: 'tags',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data.agentId).toBe('test-agent');
    });
  });

  describe('Google Drive backup endpoints', () => {
    it('should generate a Google Drive OAuth URL', async () => {
      const res = await app.request('/v1/backup/gdrive/auth-url', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data.url).toContain('accounts.google.com');
      expect(data.data.url).toContain('drive.file');
    });

    it('should list Drive backups for the current agent', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            files: [{ id: 'file-1', name: '1mbrain-backup-test-agent-now.enc' }],
          }),
          { status: 200 },
        ),
      );

      const res = await app.request('/v1/backup/gdrive', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('file-1');
    });

    it('should upload an encrypted backup to Drive', async () => {
      await engine.remember({
        agentId: 'test-agent',
        type: 'semantic',
        content: 'Drive backup memory',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'file-2', name: 'backup.enc' }), { status: 200 }),
      );

      const res = await app.request('/v1/backup/gdrive', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'test-agent',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.data.file.id).toBe('file-2');
      expect(data.data.envelope.format).toBe('1mbrain.passport.envelope');
    });

    it('should restore an encrypted backup from Drive', async () => {
      await engine.remember({
        agentId: 'source-agent',
        type: 'semantic',
        content: 'Drive restore memory',
      });

      const exportRes = await app.request('/v1/export', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'source-agent',
        },
      });
      const exported = (await exportRes.json()) as any;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(exported.data), { status: 200 }),
      );

      const restoreRes = await app.request('/v1/restore/gdrive', {
        method: 'POST',
        headers: {
          'X-API-Key': 'test-key',
          'X-Agent-Id': 'restored-agent',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId: 'file-3',
          options: {
            targetAgentId: 'restored-agent',
          },
        }),
      });

      expect(restoreRes.status).toBe(200);
      const restored = (await restoreRes.json()) as any;
      expect(restored.success).toBe(true);
      expect(restored.data.imported).toBeGreaterThan(0);
    });
  });
});
