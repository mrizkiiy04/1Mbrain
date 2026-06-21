import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Association, Memory, MemoryPassport, MemoryPassportEnvelope } from './types.js';

type SerializedMemory = Omit<Memory, 'createdAt' | 'lastAccessedAt'> & {
  createdAt: string;
  lastAccessedAt: string;
};

type SerializedAssociation = Omit<Association, 'createdAt'> & {
  createdAt: string;
};

type SerializedPassport = Omit<MemoryPassport, 'exportedAt' | 'memories' | 'associations'> & {
  exportedAt: string;
  memories: SerializedMemory[];
  associations: SerializedAssociation[];
};

export function serializePassport(passport: MemoryPassport): Buffer {
  return Buffer.from(JSON.stringify(passport), 'utf8');
}

export function deserializePassport(input: Buffer | string): MemoryPassport {
  const raw = typeof input === 'string' ? input : input.toString('utf8');
  const parsed = JSON.parse(raw) as SerializedPassport;

  return {
    ...parsed,
    exportedAt: new Date(parsed.exportedAt),
    memories: parsed.memories.map((memory) => ({
      ...memory,
      createdAt: new Date(memory.createdAt),
      lastAccessedAt: new Date(memory.lastAccessedAt),
    })),
    associations: parsed.associations.map((association) => ({
      ...association,
      createdAt: new Date(association.createdAt),
    })),
  };
}

export function createPassportEnvelope(
  passport: MemoryPassport,
  encryptionKey: string,
): MemoryPassportEnvelope {
  const key = normalizeEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const compressed = gzipSync(serializePassport(passport));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    format: '1mbrain.passport.envelope',
    version: passport.version,
    exportedAt: new Date(passport.exportedAt).toISOString(),
    sourceAgent: passport.sourceAgent,
    compression: 'gzip',
    encoding: 'base64',
    encryption: {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    },
    payload: encrypted.toString('base64'),
  };
}

export function openPassportEnvelope(
  envelope: MemoryPassportEnvelope,
  encryptionKey: string,
): MemoryPassport {
  if (envelope.format !== '1mbrain.passport.envelope') {
    throw new Error('Unsupported Memory Passport envelope format');
  }

  if (
    envelope.compression !== 'gzip' ||
    envelope.encoding !== 'base64' ||
    envelope.encryption.algorithm !== 'aes-256-gcm'
  ) {
    throw new Error('Unsupported Memory Passport envelope encoding');
  }

  const key = normalizeEncryptionKey(encryptionKey);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.encryption.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.encryption.authTag, 'base64'));

  const compressed = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload, 'base64')),
    decipher.final(),
  ]);

  return deserializePassport(gunzipSync(compressed));
}

export function normalizeEncryptionKey(input: string): Buffer {
  const trimmed = input.trim();

  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const base64 = Buffer.from(trimmed, 'base64');
  if (
    base64.length === 32 &&
    base64.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')
  ) {
    return base64;
  }

  return createHash('sha256').update(trimmed).digest();
}
