# Memory Passport Specification

Version: 1.0.0

Memory Passport is the portable snapshot format for moving 1MBrain memory between agents. It stores human-readable memory content and graph structure, not raw embedding vectors as the source of truth.

## Plain Passport

The plain passport is a JSON object used internally and for explicit debug exports with `POST /v1/export?format=json`.

```json
{
  "version": "1.0.0",
  "exportedAt": "2026-06-17T00:00:00.000Z",
  "sourceAgent": "hermes",
  "embeddingModel": "nomic-embed-text",
  "memories": [],
  "associations": [],
  "metadata": {
    "totalMemories": 0,
    "totalAssociations": 0,
    "memoryTypes": {
      "episodic": 0,
      "semantic": 0,
      "procedural": 0
    }
  }
}
```

### Memory

Each memory contains:

| Field            | Type     | Notes                                                         |
| ---------------- | -------- | ------------------------------------------------------------- |
| `id`             | string   | Original memory id. Import remaps this id when needed.        |
| `agentId`        | string   | Source namespace. Import can override with `targetAgentId`.   |
| `type`           | string   | `episodic`, `semantic`, or `procedural`.                      |
| `content`        | string   | Raw human-readable source of truth.                           |
| `embeddingModel` | null     | Export strips this value from memory rows.                    |
| `embedding`      | null     | Export strips vectors. Import regenerates embeddings locally. |
| `importance`     | number   | Float from 0 to 1.                                            |
| `decayScore`     | number   | Float from 0 to 1.                                            |
| `createdAt`      | string   | ISO 8601 timestamp.                                           |
| `lastAccessedAt` | string   | ISO 8601 timestamp.                                           |
| `tags`           | string[] | Portable labels.                                              |

### Association

Each association contains:

| Field       | Type   | Notes                                         |
| ----------- | ------ | --------------------------------------------- |
| `sourceId`  | string | Original source memory id.                    |
| `targetId`  | string | Original target memory id.                    |
| `strength`  | number | Float from 0 to 1.                            |
| `origin`    | string | `co-occurrence`, `similarity`, or `explicit`. |
| `createdAt` | string | ISO 8601 timestamp.                           |

## Encrypted Envelope

The default API export returns an encrypted envelope:

```json
{
  "format": "1mbrain.passport.envelope",
  "version": "1.0.0",
  "exportedAt": "2026-06-17T00:00:00.000Z",
  "sourceAgent": "hermes",
  "compression": "gzip",
  "encoding": "base64",
  "encryption": {
    "algorithm": "aes-256-gcm",
    "iv": "base64-iv",
    "authTag": "base64-auth-tag"
  },
  "payload": "base64-ciphertext"
}
```

Envelope processing order:

1. Serialize the plain passport as UTF-8 JSON.
2. Compress with gzip.
3. Encrypt with AES-256-GCM.
4. Base64-encode the ciphertext, IV, and auth tag.

`EXPORT_ENCRYPTION_KEY` is the configurable key source. A 64-character hex value is used directly as 32 bytes. A valid 32-byte base64 value is decoded directly. Any other string is normalized with SHA-256 for local-development ergonomics.

## API

### Export

`POST /v1/export`

Default response:

```json
{
  "success": true,
  "data": {
    "format": "1mbrain.passport.envelope"
  },
  "meta": {
    "format": "encrypted",
    "encrypted": true,
    "compressed": true,
    "algorithm": "aes-256-gcm"
  }
}
```

Debug/plain export:

`POST /v1/export?format=json`

### Import

`POST /v1/import`

Plain passport body:

```json
{
  "passport": {},
  "options": {
    "targetAgentId": "new-agent",
    "conflictStrategy": "skip"
  }
}
```

Encrypted envelope body:

```json
{
  "envelope": {},
  "options": {
    "targetAgentId": "new-agent",
    "conflictStrategy": "merge"
  }
}
```

Conflict strategies:

| Strategy    | Behavior                                                |
| ----------- | ------------------------------------------------------- |
| `skip`      | Reuses matching existing memories and skips duplicates. |
| `merge`     | Merges tags and keeps the higher importance.            |
| `overwrite` | Deletes the closest duplicate and imports a new memory. |

## Compatibility Rules

- Import must not trust exported vectors. Content is always re-embedded using the target instance's embedding provider.
- Associations are reconstructed after memory import using the import id mapping.
- Unknown envelope compression, encoding, or encryption algorithms must be rejected.
- Consumers should treat `version` as semver and reject incompatible major versions.
