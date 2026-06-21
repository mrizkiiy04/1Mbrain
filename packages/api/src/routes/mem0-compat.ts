/**
 * Mem0 Compatibility Routes
 *
 * Minimal OSS-compatible surface for the benchmark runner:
 * - POST /memories
 * - POST /search
 * - DELETE /memories?user_id=...
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { MemoryEngine } from '@1mbrain/core';

type Env = {
  Variables: {
    engine: MemoryEngine;
  };
};

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function concatMessages(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  return messages
    .map((message) => {
      if (!message || typeof message !== 'object') {
        return toText(message);
      }
      const record = message as Record<string, unknown>;
      return toText(record.content ?? record.text ?? '');
    })
    .filter(Boolean)
    .join('\n');
}

export function createMem0CompatRoutes() {
  const app = new Hono<Env>();

  app.post('/memories', async (c) => {
    const engine = c.get('engine');
    const body = await c.req.json().catch(() => ({}));
    const userId = toText((body as Record<string, unknown>).user_id);
    const messages = (body as Record<string, unknown>).messages;
    const content = concatMessages(messages);

    if (!userId) {
      throw new HTTPException(400, { message: 'user_id is required' });
    }
    if (!content) {
      throw new HTTPException(400, { message: 'messages are required' });
    }

    const memory = await engine.remember({
      agentId: userId,
      content,
      type: 'episodic',
      metadata: (body as Record<string, unknown>).metadata as Record<string, unknown> | undefined,
      tags: [],
    });

    return c.json({
      results: [
        {
          id: memory.id,
          memory: memory.content,
          event: 'ADD',
        },
      ],
    });
  });

  app.post('/search', async (c) => {
    const engine = c.get('engine');
    const body = await c.req.json().catch(() => ({}));
    const userId = toText((body as Record<string, unknown>).user_id);
    const query = toText((body as Record<string, unknown>).query);
    const limitRaw = (body as Record<string, unknown>).limit;
    const limit = typeof limitRaw === 'number' ? limitRaw : Number(limitRaw ?? 20);

    if (!userId) {
      throw new HTTPException(400, { message: 'user_id is required' });
    }
    if (!query) {
      throw new HTTPException(400, { message: 'query is required' });
    }

    const results = await engine.recall({
      agentId: userId,
      query,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    });

    return c.json({
      results: results.map((result) => ({
        id: result.memory.id,
        memory: result.memory.content,
        score: result.score,
      })),
    });
  });

  app.delete('/memories', async (c) => {
    const engine = c.get('engine');
    const userId = c.req.query('user_id');

    if (!userId) {
      throw new HTTPException(400, { message: 'user_id is required' });
    }

    await engine.resetAgent(userId);

    return c.json({ results: [] });
  });

  return app;
}
