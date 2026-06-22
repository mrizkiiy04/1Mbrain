/**
 * Memory Routes
 *
 * REST endpoints for the memory CRUD operations:
 * - POST   /v1/memories          — remember
 * - GET    /v1/memories/search    — recall (vector + spreading activation)
 * - GET    /v1/memories/:id       — get single memory
 * - DELETE /v1/memories/:id       — forget
 * - POST   /v1/memories/:id/associate — create explicit association
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { CreateMemorySchema, SearchMemorySchema, CreateAssociationSchema } from '@1mbrain/core';
import type { MemoryEngine } from '@1mbrain/core';
import type { AuthContext } from '../middleware/auth.js';

type Env = {
  Variables: {
    auth: AuthContext;
    engine: MemoryEngine;
  };
};

export function createMemoryRoutes() {
  const app = new Hono<Env>();

  // ─── POST /v1/memories — remember ───────────────────

  app.post('/', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');
    const body = await c.req.json();

    const parsed = CreateMemorySchema.safeParse({
      ...body,
      agentId: auth.agentId,
    });

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const memory = await engine.remember(parsed.data);

    return c.json(
      {
        success: true,
        data: memory,
      },
      201,
    );
  });

  // ─── GET /v1/memories/search — recall ───────────────

  app.get('/search', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');

    const parsed = SearchMemorySchema.safeParse({
      ...c.req.query(),
      agentId: auth.agentId,
    });

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const results = await engine.recall({
      agentId: parsed.data.agentId,
      query: parsed.data.q,
      type: parsed.data.type,
      tags: parsed.data.tags as string[] | undefined,
      limit: parsed.data.limit,
      threshold: parsed.data.threshold,
      useSpreadingActivation: parsed.data.useSpreadingActivation,
      maxHops: parsed.data.maxHops,
      activationThreshold: parsed.data.activationThreshold,
      blendWeight: parsed.data.blendWeight,
    });

    return c.json({
      success: true,
      data: results,
      meta: {
        total: results.length,
        query: parsed.data.q,
        agentId: parsed.data.agentId,
        confidence: (results as any).confidence,
        reason: (results as any).abstainedReason,
      },
    });
  });

  // ─── GET /v1/memories/:id — get single memory ──────

  app.get('/:id', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');

    // Access via the engine's internal DB (we need to add a public method)
    // For now, use recall with a direct ID lookup approach
    await engine.recall({
      agentId: auth.agentId,
      query: '', // Empty query — we'll need to handle this case
      limit: 1,
    });

    // TODO: Add a getById method to the engine
    // For now, return a not-implemented if query is empty
    throw new HTTPException(501, {
      message: 'Direct ID lookup will be available soon. Use /search endpoint.',
    });
  });

  // ─── DELETE /v1/memories/:id — forget ───────────────

  app.delete('/:id', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');
    const id = c.req.param('id');

    const deleted = await engine.forget(id, auth.agentId);

    if (!deleted) {
      throw new HTTPException(404, {
        message: `Memory ${id} not found or does not belong to agent ${auth.agentId}`,
      });
    }

    return c.json({
      success: true,
      message: `Memory ${id} forgotten`,
    });
  });

  // ─── POST /v1/memories/:id/associate — link ────────

  app.post('/:id/associate', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');
    const sourceId = c.req.param('id');
    const body = await c.req.json();

    const parsed = CreateAssociationSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    try {
      await engine.associate({
        sourceId,
        targetId: parsed.data.targetId,
        agentId: auth.agentId,
        strength: parsed.data.strength,
        origin: parsed.data.origin,
        relationType: parsed.data.relationType,
      });
    } catch (err) {
      throw new HTTPException(404, {
        message: err instanceof Error ? err.message : 'Unable to create association',
      });
    }

    return c.json({
      success: true,
      message: `Association created between ${sourceId} and ${parsed.data.targetId}`,
    });
  });

  return app;
}
