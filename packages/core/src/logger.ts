/**
 * Pino Logger
 *
 * Structured logging used throughout 1MBrain.
 * Logs in JSON format for production, pretty-printed in development.
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: '1mbrain',
  },
});

export function createChildLogger(name: string) {
  return logger.child({ component: name });
}
