import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { createChildLogger } from '@1mbrain/core';
import type { DatabaseProvider } from '@1mbrain/core';
import crypto from 'crypto';

const log = createChildLogger('auth');

export interface AuthContext {
  agentId: string;
  apiKey: string;
  isMaster: boolean;
}

function extractApiKey(c: any): string | null {
  const headerKey = c.req.header('x-api-key');
  if (headerKey) return headerKey;

  const authHeader = c.req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

export const authMiddleware = createMiddleware<any>(async (c, next) => {
  const apiKey = extractApiKey(c);

  if (!apiKey) {
    log.warn('Missing API key');
    throw new HTTPException(401, {
      message: 'Missing API key. Provide it via X-API-Key header or Authorization: Bearer.',
    });
  }

  const masterKey = process.env.MASTER_API_KEY;

  if (!masterKey) {
    log.error('MASTER_API_KEY not configured');
    throw new HTTPException(500, {
      message: 'Server misconfigured: no API key set.',
    });
  }

  // Use timingSafeEqual to prevent timing attacks
  const providedBuffer = Buffer.from(apiKey);
  const masterBuffer = Buffer.from(masterKey);

  let isMaster = false;
  if (providedBuffer.length === masterBuffer.length) {
    isMaster = crypto.timingSafeEqual(providedBuffer, masterBuffer);
  }

  let agentId = 'default';

  if (isMaster) {
    // Master key can impersonate any agent via header
    agentId = c.req.header('x-agent-id') || 'default';
  } else {
    // Look up API key in DB
    const db = c.get('db') as DatabaseProvider;
    if (!db) {
      log.error('Database provider not found in context');
      throw new HTTPException(500, { message: 'Internal Server Error' });
    }

    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const record = await db.getApiKeyByHash(hash);

    if (!record) {
      log.warn('Invalid API key attempt (not found or inactive)');
      throw new HTTPException(401, {
        message: 'Invalid API key.',
      });
    }

    agentId = record.agentId;

    // Fire and forget last_used_at update
    db.updateApiKeyLastUsed(record.id).catch((err) => {
      log.error({ err, keyId: record.id }, 'Failed to update API key last_used_at');
    });
  }

  c.set('auth', { agentId, apiKey, isMaster });

  await next();
});
