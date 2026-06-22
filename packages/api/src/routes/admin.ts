import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { DatabaseProvider } from '@1mbrain/core';
import type { AuthContext } from '../middleware/auth.js';
import crypto from 'crypto';

type Env = {
  Variables: {
    auth: AuthContext;
    db: DatabaseProvider;
  };
};

export function createAdminRoutes() {
  const app = new Hono<Env>();

  // Ensure only master key can access admin routes
  app.use('*', async (c, next) => {
    const auth = c.get('auth');
    if (!auth.isMaster) {
      throw new HTTPException(403, { message: 'Forbidden. Master API Key required.' });
    }
    await next();
  });

  // POST /v1/admin/api-keys
  app.post('/api-keys', async (c) => {
    const db = c.get('db');
    const body = await c.req.json();

    if (!body.agentId || !body.name) {
      throw new HTTPException(400, { message: 'Missing agentId or name' });
    }

    // Generate a random 32-byte key
    const rawKey = '1mb_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const record = await db.createApiKey({
      id: crypto.randomUUID(),
      keyHash,
      agentId: body.agentId,
      name: body.name,
      isActive: true,
    });

    return c.json(
      {
        success: true,
        data: {
          ...record,
          apiKey: rawKey, // only returned once
        },
      },
      201
    );
  });

  // GET /v1/admin/api-keys/:agentId
  app.get('/api-keys/:agentId', async (c) => {
    const db = c.get('db');
    const agentId = c.req.param('agentId');

    const keys = await db.getApiKeysByAgent(agentId);

    return c.json({
      success: true,
      data: keys.map((k: any) => ({
        id: k.id,
        agentId: k.agentId,
        name: k.name,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        isActive: k.isActive
      }))
    });
  });

  // DELETE /v1/admin/api-keys/:id
  app.delete('/api-keys/:id', async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');

    const revoked = await db.revokeApiKey(id);

    if (!revoked) {
      throw new HTTPException(404, { message: 'API key not found' });
    }

    return c.json({
      success: true,
      message: 'API key revoked'
    });
  });

  return app;
}
