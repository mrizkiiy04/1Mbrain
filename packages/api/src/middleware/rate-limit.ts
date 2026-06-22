import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { createChildLogger } from '@1mbrain/core';
import type { AuthContext } from './auth.js';

const log = createChildLogger('rate-limit');

// Simple in-memory sliding window rate limiter
// Key: IP address or API Key Hash
// Value: array of timestamps
const rateLimits = new Map<string, number[]>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

export const rateLimitMiddleware = createMiddleware<{
  Variables: {
    auth?: AuthContext;
  };
}>(async (c, next) => {
  const auth = c.get('auth');
  
  // Use API Key if available, otherwise use IP address
  // Note: if behind a proxy, we'd need to check X-Forwarded-For
  const clientIp = c.req.header('x-forwarded-for') || 'unknown';
  const key = auth?.apiKey || clientIp;

  const now = Date.now();
  let timestamps = rateLimits.get(key) || [];

  // Remove timestamps older than the window
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    log.warn({ key: auth?.agentId || clientIp }, 'Rate limit exceeded');
    throw new HTTPException(429, {
      message: 'Too many requests. Please try again later.',
    });
  }

  timestamps.push(now);
  rateLimits.set(key, timestamps);

  // Set standard rate limit headers
  c.res.headers.set('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW.toString());
  c.res.headers.set('X-RateLimit-Remaining', (MAX_REQUESTS_PER_WINDOW - timestamps.length).toString());
  c.res.headers.set('X-RateLimit-Reset', Math.ceil((timestamps[0] + WINDOW_MS) / 1000).toString());

  await next();
});
