/**
 * 1MBrain API Server
 *
 * Entry point for the Hono-based REST + WebSocket server.
 * Initializes all components and mounts routes.
 */

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createNodeWebSocket } from '@hono/node-ws';
import {
  loadConfig,
  createDatabaseProvider,
  createEmbeddingProvider,
  createEventBus,
  MemoryEngine,
  createChildLogger,
} from '@1mbrain/core';
import { ConsolidationEngine, createConsolidationScheduler } from '@1mbrain/consolidation';
import type { MemoryEngine as MemoryEngineType, DatabaseProvider, EventBus } from '@1mbrain/core';
import { authMiddleware } from './middleware/auth.js';
import type { AuthContext } from './middleware/auth.js';
import { requestLogger } from './middleware/logger.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { createMemoryRoutes } from './routes/memories.js';
import { createPassportRoutes } from './routes/passport.js';
import { createBackupRoutes } from './routes/backup.js';
import { createDashboardRoutes } from './routes/dashboard.js';
import { createIngestRoutes } from './routes/ingest.js';
import { createConsolidateRoutes } from './routes/consolidate.js';
import { createAdminRoutes } from './routes/admin.js';

const log = createChildLogger('server');

type AppEnv = {
  Variables: {
    auth: AuthContext;
    engine: MemoryEngineType;
    eventBus: EventBus;
    db: DatabaseProvider;
  };
};

async function main() {
  const config = loadConfig();

  log.info(
    {
      dbProvider: config.database.provider,
      embeddingProvider: config.embedding.provider,
      redis: !!config.redis,
    },
    '1MBrain starting...',
  );

  // ─── Initialize Components ──────────────────────────

  // Database
  const db = createDatabaseProvider(config.database);
  await db.initialize();

  // Embedding
  const embedder = createEmbeddingProvider(config.embedding);

  // Event Bus
  const eventBus = await createEventBus(config.redis?.url);

  // Memory Engine
  const engine = new MemoryEngine(db, embedder, eventBus);
  const consolidationEngine = new ConsolidationEngine(engine, db, eventBus);
  const consolidationScheduler = createConsolidationScheduler(engine, db, eventBus);

  // Start decay loop
  if (config.decay) {
    engine.startDecayLoop(config.decay.intervalMs, config.decay.rate, config.decay.minScore);
  }
  consolidationScheduler.start();

  // ─── Create Hono App ────────────────────────────────

  const app = new Hono<AppEnv>();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // Global middleware
  app.use('*', cors());
  app.use('*', requestLogger);
  app.use('*', rateLimitMiddleware);

  // Inject engine and db into context for all routes
  app.use('*', async (c, next) => {
    c.set('engine', engine);
    c.set('eventBus', eventBus);
    c.set('db', db);
    await next();
  });

  // ─── Public Routes ──────────────────────────────────

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: '1mbrain',
      version: '0.1.0',
      uptime: process.uptime(),
      database: config.database.provider,
      embedding: config.embedding.provider,
    });
  });

  // Public alias — many agent frameworks and monitoring tools probe /v1/health
  app.get('/v1/health', (c) => {
    return c.json({
      status: 'ok',
      service: '1mbrain',
      version: '0.1.0',
      uptime: process.uptime(),
      database: config.database.provider,
      embedding: config.embedding.provider,
    });
  });

  app.get('/', (c) => {
    return c.json({
      name: '1MBrain',
      tagline: 'A portable, semantic graph memory layer for any AI agent.',
      version: '0.1.0',
      docs: '/health',
      endpoints: {
        memories: '/v1/memories',
        search: '/v1/memories/search?q=...',
        export: '/v1/export',
        import: '/v1/import',
        dashboard: '/v1/dashboard/stream (WebSocket)',
      },
    });
  });

  // ─── Protected Routes ───────────────────────────────────

  app.use('/v1/*', async (c, next) => {
    // WebSocket authentication is handled via handshake message in dashboard.ts
    if (c.req.path === '/v1/dashboard/stream') {
      return next();
    }
    return authMiddleware(c, next);
  });

  app.route('/v1/memories', createMemoryRoutes());
  app.route('/v1', createConsolidateRoutes(consolidationEngine));
  app.route('/v1', createPassportRoutes());
  app.route('/v1', createBackupRoutes());
  app.route('/v1/admin', createAdminRoutes());

  // ─── Ingest Routes ──────────────────────────────────
  // The pipeline self-calls the memory API — pass internal URL + a trusted key.
  const internalApiUrl = `http://localhost:${process.env['PORT'] ?? '3100'}`;
  const internalApiKey = process.env['ONEMILLION_API_KEY'] ?? '';
  app.route('/v1/ingest', createIngestRoutes(internalApiUrl, internalApiKey));

  // ─── WebSocket Route (dashboard) ────────────────────

  app.route('/v1/dashboard', createDashboardRoutes(upgradeWebSocket, eventBus));

  // ─── Error Handler ──────────────────────────────────

  app.onError((err, c) => {
    log.error({ err: err.message, stack: err.stack }, 'Unhandled error');

    const status = 'status' in err ? (err.status as number) : 500;
    return c.json(
      {
        error: err.message || 'Internal server error',
        status,
      },
      status as 400,
    );
  });

  // ─── Not Found ──────────────────────────────────────

  app.notFound((c) => {
    return c.json(
      {
        error: 'Not found',
        message: `Route ${c.req.method} ${c.req.path} does not exist`,
      },
      404,
    );
  });

  // ─── Start Server ──────────────────────────────────

  const port = parseInt(process.env.PORT || '3100', 10);
  const host = process.env.HOST || '0.0.0.0';

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => {
      log.info(`
  ╔══════════════════════════════════════════════╗
  ║                                              ║
  ║   🧠 1MBrain is alive                        ║
  ║                                              ║
  ║   http://${host}:${info.port}                     ║
  ║                                              ║
  ║   DB:        ${config.database.provider.padEnd(30)}║
  ║   Embedding: ${config.embedding.provider.padEnd(30)}║
  ║   Redis:     ${config.redis ? 'connected' : 'in-memory fallback'}${' '.repeat(config.redis ? 21 : 14)}║
  ║                                              ║
  ╚══════════════════════════════════════════════╝
    `);
    },
  );

  injectWebSocket(server);

  // ─── Graceful Shutdown ─────────────────────────────

  const shutdown = async () => {
    log.info('Shutting down gracefully...');
    consolidationScheduler.stop();
    await engine.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
