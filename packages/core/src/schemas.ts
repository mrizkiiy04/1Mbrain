/**
 * Zod Schemas for request validation
 *
 * These schemas validate all API inputs and can generate
 * TypeScript types that stay in sync with the validation rules.
 */

import { z } from 'zod';

const BooleanQuerySchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'false') return false;
    if (value.toLowerCase() === 'true') return true;
  }

  return value;
}, z.boolean());

// ─── Enums ──────────────────────────────────────────────

export const MemoryTypeSchema = z.enum(['episodic', 'semantic', 'procedural', 'entity', 'warning']);

export const AssociationOriginSchema = z.enum(['co-occurrence', 'similarity', 'explicit']);

export const AssociationRelationTypeSchema = z.enum(['relates_to', 'supersedes', 'derived_from']);

// ─── Create Memory ──────────────────────────────────────

export const CreateMemorySchema = z.object({
  agentId: z
    .string()
    .min(1, 'agentId is required')
    .max(128, 'agentId must be 128 characters or less')
    .regex(/^[a-zA-Z0-9_-]+$/, 'agentId must be alphanumeric with hyphens/underscores'),
  type: MemoryTypeSchema,
  content: z.string().min(1, 'content is required').max(65536, 'content must be 64KB or less'),
  importance: z
    .number()
    .min(0, 'importance must be between 0 and 1')
    .max(1, 'importance must be between 0 and 1')
    .default(0.5),
  tags: z.array(z.string().max(64)).max(32, 'maximum 32 tags allowed').default([]),
  /**
   * Optional structured metadata attached to the memory.
   * Commonly used by the ingest pipeline to store sourceUrl, evidence, confidence, etc.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
  associations: z
    .array(
      z.object({
        targetId: z.string().uuid('targetId must be a valid UUID'),
        strength: z.number().min(0).max(1).default(0.5),
        relationType: AssociationRelationTypeSchema.default('relates_to'),
      }),
    )
    .max(50, 'maximum 50 associations per memory')
    .optional(),
});

// ─── Search Memory ──────────────────────────────────────

export const SearchMemorySchema = z.object({
  q: z.string().min(1, 'query is required').max(4096, 'query must be 4KB or less'),
  agentId: z.string().min(1).max(128),
  type: MemoryTypeSchema.optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? val.split(',') : val))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.3),
  useSpreadingActivation: BooleanQuerySchema.default(true),
  maxHops: z.coerce.number().int().min(1).max(5).default(2),
  activationThreshold: z.coerce.number().min(0).max(1).default(0.15),
  blendWeight: z.coerce.number().min(0).max(1).default(0.35),
  crossAgent: BooleanQuerySchema.optional(),
  historyMode: z.enum(['current', 'latest', 'all']).default('current'),
});

// ─── Create Association ─────────────────────────────────

export const CreateAssociationSchema = z.object({
  targetId: z.string().uuid('targetId must be a valid UUID'),
  strength: z
    .number()
    .min(0, 'strength must be between 0 and 1')
    .max(1, 'strength must be between 0 and 1')
    .default(0.5),
  origin: AssociationOriginSchema.default('explicit'),
  relationType: AssociationRelationTypeSchema.default('relates_to'),
});

// ─── Memory Passport ────────────────────────────────────

export const ImportPassportSchema = z.object({
  conflictStrategy: z.enum(['skip', 'merge', 'overwrite']).default('skip'),
  targetAgentId: z.string().min(1).max(128).optional(),
});

export const ExportPassportSchema = z.object({
  format: z.enum(['encrypted', 'json']).default('encrypted'),
});

// ─── API Key ────────────────────────────────────────────

export const ApiKeyHeaderSchema = z.object({
  'x-api-key': z.string().min(1, 'API key is required'),
});

// ─── Derived Types ──────────────────────────────────────

export type CreateMemoryPayload = z.infer<typeof CreateMemorySchema>;
export type SearchMemoryQuery = z.infer<typeof SearchMemorySchema>;
export type CreateAssociationPayload = z.infer<typeof CreateAssociationSchema>;
export type ExportPassportPayload = z.infer<typeof ExportPassportSchema>;
export type ImportPassportPayload = z.infer<typeof ImportPassportSchema>;
