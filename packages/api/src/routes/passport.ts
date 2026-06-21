/**
 * Passport Routes
 *
 * Memory Passport export/import endpoints:
 * - POST /v1/export — generate Memory Passport
 * - POST /v1/import — ingest a Memory Passport
 */

import { Hono } from 'hono';
import {
  createPassportEnvelope,
  ExportPassportSchema,
  ImportPassportSchema,
  openPassportEnvelope,
} from '@1mbrain/core';
import type { MemoryEngine, MemoryPassport, MemoryPassportEnvelope } from '@1mbrain/core';
import type { AuthContext } from '../middleware/auth.js';

type Env = {
  Variables: {
    auth: AuthContext;
    engine: MemoryEngine;
  };
};

export function createPassportRoutes() {
  const app = new Hono<Env>();

  // ─── POST /v1/export — generate Memory Passport ────

  app.post('/export', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');
    const body = await c.req.json().catch(() => ({}));
    const parsed = ExportPassportSchema.safeParse({
      format: body.format || c.req.query('format') || 'encrypted',
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

    const passport = await engine.exportPassport(auth.agentId);

    if (parsed.data.format === 'json') {
      return c.json({
        success: true,
        data: passport,
        meta: {
          format: 'json',
          encrypted: false,
          compressed: false,
        },
      });
    }

    const encryptionKey = process.env.EXPORT_ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json(
        {
          error: 'Export encryption key is not configured',
          details: {
            EXPORT_ENCRYPTION_KEY: ['Set EXPORT_ENCRYPTION_KEY or request format=json explicitly.'],
          },
        },
        500,
      );
    }

    const envelope = createPassportEnvelope(passport, encryptionKey);

    return c.json({
      success: true,
      data: envelope,
      meta: {
        format: 'encrypted',
        encrypted: true,
        compressed: true,
        algorithm: envelope.encryption.algorithm,
      },
    });
  });

  // ─── POST /v1/import — ingest a Memory Passport ────

  app.post('/import', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');
    const body = await c.req.json();

    // Validate options
    const optionsParsed = ImportPassportSchema.safeParse(body.options || {});
    if (!optionsParsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: optionsParsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const passport = parsePassportBody(body);
    if (!passport || !passport.version || !passport.memories) {
      return c.json(
        {
          error: 'Invalid Memory Passport format',
          details: { passport: ['Must include version, memories, and associations'] },
        },
        400,
      );
    }

    const result = await engine.importPassport(
      passport,
      optionsParsed.data.targetAgentId || auth.agentId,
      optionsParsed.data.conflictStrategy,
    );

    return c.json({
      success: true,
      data: result,
    });
  });

  return app;
}

function parsePassportBody(body: Record<string, unknown>): MemoryPassport | null {
  if (body.passport) {
    return body.passport as MemoryPassport;
  }

  const envelope = body.envelope || body.passportEnvelope;
  if (!envelope) {
    return null;
  }

  const encryptionKey = process.env.EXPORT_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('EXPORT_ENCRYPTION_KEY is required to import an encrypted Memory Passport');
  }

  return openPassportEnvelope(envelope as MemoryPassportEnvelope, encryptionKey);
}
