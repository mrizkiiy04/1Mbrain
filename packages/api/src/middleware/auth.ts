/**
 * Auth Middleware
 *
 * Validates API key from X-API-Key header.
 * In development, accepts the MASTER_API_KEY directly.
 * In production, validates against hashed keys in the database.
 *
 * For now (Phase 1), we use a simple API key check against env.
 * Database-backed key management will come later.
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { createChildLogger } from '@1mbrain/core';

const log = createChildLogger('auth');

export interface AuthContext {
  agentId: string;
  apiKey: string;
}

export const authMiddleware = createMiddleware<{
  Variables: {
    auth: AuthContext;
  };
}>(async (c, next) => {
  const apiKey = c.req.header('x-api-key') || c.req.query('apiKey');

  if (!apiKey) {
    log.warn('Missing API key');
    throw new HTTPException(401, {
      message: 'Missing API key. Provide it via X-API-Key header.',
    });
  }

  const masterKey = process.env.MASTER_API_KEY;

  if (!masterKey) {
    log.error('MASTER_API_KEY not configured');
    throw new HTTPException(500, {
      message: 'Server misconfigured: no API key set.',
    });
  }

  if (apiKey !== masterKey) {
    log.warn('Invalid API key attempt');
    throw new HTTPException(403, {
      message: 'Invalid API key.',
    });
  }

  // Extract agentId from header or query param
  const agentId = c.req.header('x-agent-id') || c.req.query('agentId') || 'default';

  c.set('auth', { agentId, apiKey });

  await next();
});
