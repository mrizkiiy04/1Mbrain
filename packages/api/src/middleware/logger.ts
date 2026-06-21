/**
 * Request Logger Middleware
 *
 * Logs all incoming requests with timing, status, and error details.
 */

import { createMiddleware } from 'hono/factory';
import { createChildLogger } from '@1mbrain/core';

const log = createChildLogger('http');

export const requestLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  log.debug({ method, path }, 'Incoming request');

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  if (status >= 400) {
    log.warn({ method, path, status, duration }, 'Request completed with error');
  } else {
    log.info({ method, path, status, duration }, 'Request completed');
  }
});
