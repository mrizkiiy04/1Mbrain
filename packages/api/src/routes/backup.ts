/**
 * Google Drive backup and restore routes.
 *
 * These endpoints keep Google Drive optional: the core service still runs
 * without Drive credentials, and Drive is only touched when these routes run.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createPassportEnvelope, ImportPassportSchema, openPassportEnvelope } from '@1mbrain/core';
import type { MemoryEngine, MemoryPassportEnvelope } from '@1mbrain/core';
import type { AuthContext } from '../middleware/auth.js';

type Env = {
  Variables: {
    auth: AuthContext;
    engine: MemoryEngine;
  };
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_MIME_TYPE = 'application/vnd.1mbrain.passport+json';

export function createBackupRoutes() {
  const app = new Hono<Env>();

  app.get('/backup/gdrive/auth-url', (c) => {
    const clientId = requireEnv('GDRIVE_CLIENT_ID');
    const redirectUri = requireEnv('GDRIVE_REDIRECT_URI');
    const state = c.req.query('state') || c.get('auth').agentId;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', DRIVE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);

    return c.json({
      success: true,
      data: {
        url: url.toString(),
        scope: DRIVE_SCOPE,
      },
    });
  });

  app.post('/backup/gdrive/token', async (c) => {
    const body = await c.req.json();
    const code = body.code;

    if (typeof code !== 'string' || !code.trim()) {
      return c.json({ error: 'Validation failed', details: { code: ['code is required'] } }, 400);
    }

    const token = await exchangeCodeForToken(code.trim());

    return c.json({
      success: true,
      data: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresIn: token.expires_in,
        scope: token.scope,
        tokenType: token.token_type,
      },
    });
  });

  app.get('/backup/gdrive', async (c) => {
    const auth = c.get('auth');
    const accessToken = await getGoogleAccessToken();
    const files = await listDriveBackups(accessToken, auth.agentId);

    return c.json({
      success: true,
      data: files,
      meta: {
        total: files.length,
        agentId: auth.agentId,
      },
    });
  });

  app.post('/backup/gdrive', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');
    const encryptionKey = requireEnv('EXPORT_ENCRYPTION_KEY');
    const accessToken = await getGoogleAccessToken();
    const passport = await engine.exportPassport(auth.agentId);
    const envelope = createPassportEnvelope(passport, encryptionKey);
    const filename = createBackupFilename(auth.agentId);
    const uploaded = await uploadDriveBackup(accessToken, filename, envelope);

    return c.json({
      success: true,
      data: {
        file: uploaded,
        filename,
        envelope: {
          format: envelope.format,
          version: envelope.version,
          sourceAgent: envelope.sourceAgent,
          exportedAt: envelope.exportedAt,
        },
      },
    });
  });

  app.post('/restore/gdrive', async (c) => {
    const auth = c.get('auth');
    const engine = c.get('engine');
    const body = await c.req.json();

    if (typeof body.fileId !== 'string' || !body.fileId.trim()) {
      return c.json(
        { error: 'Validation failed', details: { fileId: ['fileId is required'] } },
        400,
      );
    }

    const optionsParsed = ImportPassportSchema.safeParse(body.options || {});

    if (!optionsParsed.success) {
      throw new HTTPException(400, { message: 'Invalid import options' });
    }

    let targetAgentId = auth.agentId;
    // Allow master key to override targetAgentId
    if ((auth as any).isMaster && optionsParsed.data.targetAgentId) {
      targetAgentId = optionsParsed.data.targetAgentId;
    }

    try {
      const accessToken = await getGoogleAccessToken();
      const envelope = await downloadDriveBackup(accessToken, body.fileId.trim());

      const passport = openPassportEnvelope(envelope, requireEnv('EXPORT_ENCRYPTION_KEY'));
      const result = await engine.importPassport(
        passport,
        targetAgentId,
        optionsParsed.data.conflictStrategy,
      );

      return c.json({
        success: true,
        data: result,
        meta: {
          fileId: body.fileId.trim(),
          targetAgentId: targetAgentId,
        },
      });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  return app;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

async function exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: requireEnv('GDRIVE_CLIENT_ID'),
      client_secret: requireEnv('GDRIVE_CLIENT_SECRET'),
      redirect_uri: requireEnv('GDRIVE_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  });

  return parseGoogleResponse<GoogleTokenResponse>(response);
}

async function getGoogleAccessToken(): Promise<string> {
  if (process.env.GDRIVE_ACCESS_TOKEN) {
    return process.env.GDRIVE_ACCESS_TOKEN;
  }

  const refreshToken = requireEnv('GDRIVE_REFRESH_TOKEN');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: requireEnv('GDRIVE_CLIENT_ID'),
      client_secret: requireEnv('GDRIVE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const token = await parseGoogleResponse<GoogleTokenResponse>(response);

  return token.access_token;
}

async function listDriveBackups(accessToken: string, agentId: string): Promise<DriveFile[]> {
  const query = ['trashed = false', `name contains '1mbrain-backup-${escapeDriveQuery(agentId)}-'`];

  const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
  if (folderId) {
    query.push(`'${escapeDriveQuery(folderId)}' in parents`);
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', query.join(' and '));
  url.searchParams.set('fields', 'files(id,name,mimeType,createdTime,modifiedTime,size)');
  url.searchParams.set('orderBy', 'createdTime desc');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const parsed = await parseGoogleResponse<{ files: DriveFile[] }>(response);

  return parsed.files;
}

async function uploadDriveBackup(
  accessToken: string,
  filename: string,
  envelope: MemoryPassportEnvelope,
): Promise<DriveFile> {
  const metadata: Record<string, unknown> = {
    name: filename,
    mimeType: BACKUP_MIME_TYPE,
  };

  if (process.env.GDRIVE_BACKUP_FOLDER_ID) {
    metadata.parents = [process.env.GDRIVE_BACKUP_FOLDER_ID];
  }

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(envelope)], { type: 'application/json' }), filename);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    },
  );

  return parseGoogleResponse<DriveFile>(response);
}

async function downloadDriveBackup(
  accessToken: string,
  fileId: string,
): Promise<MemoryPassportEnvelope> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return parseGoogleResponse<MemoryPassportEnvelope>(response);
}

async function parseGoogleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      typeof data?.error_description === 'string'
        ? data.error_description
        : typeof data?.error?.message === 'string'
          ? data.error.message
          : `Google API request failed with ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

function createBackupFilename(agentId: string): string {
  const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `1mbrain-backup-${safeAgent}-${new Date().toISOString().replace(/[:.]/g, '-')}.enc`;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
