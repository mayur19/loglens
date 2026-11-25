import type { ApiKeySummary } from '@loglens/shared';
import type { Db } from '../../db/pool.js';

interface ApiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  default_service: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly keyHash: string;
  readonly defaultService: string | null;
  readonly revoked: boolean;
}

const COLUMNS =
  'id, organization_id, name, prefix, key_hash, default_service, created_at, last_used_at, revoked_at';

const toSummary = (r: ApiKeyRow): ApiKeySummary => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  defaultService: r.default_service,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
  revokedAt: r.revoked_at?.toISOString() ?? null,
});

export async function insertApiKey(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    prefix: string;
    keyHash: string;
    defaultService: string | null;
    createdBy: string;
  },
): Promise<ApiKeySummary> {
  const { rows } = await db.query<ApiKeyRow>(
    `INSERT INTO api_keys (organization_id, name, prefix, key_hash, default_service, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [
      input.organizationId,
      input.name,
      input.prefix,
      input.keyHash,
      input.defaultService,
      input.createdBy,
    ],
  );
  return toSummary(rows[0] as ApiKeyRow);
}

export async function listApiKeys(
  db: Db,
  organizationId: string,
): Promise<readonly ApiKeySummary[]> {
  const { rows } = await db.query<ApiKeyRow>(
    `SELECT ${COLUMNS} FROM api_keys WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows.map(toSummary);
}

export async function revokeApiKey(
  db: Db,
  organizationId: string,
  id: string,
): Promise<ApiKeySummary | null> {
  const { rows } = await db.query<ApiKeyRow>(
    `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE organization_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    [organizationId, id],
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

/** Lookup by public prefix only; the caller compares hashes in constant time. */
export async function findApiKeyByPrefix(db: Db, prefix: string): Promise<ApiKeyRecord | null> {
  const { rows } = await db.query<ApiKeyRow>(`SELECT ${COLUMNS} FROM api_keys WHERE prefix = $1`, [
    prefix,
  ]);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        organizationId: r.organization_id,
        keyHash: r.key_hash,
        defaultService: r.default_service,
        revoked: r.revoked_at !== null,
      }
    : null;
}

export async function markApiKeyUsed(db: Db, id: string): Promise<void> {
  await db.query(
    `UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
    [id],
  );
}
