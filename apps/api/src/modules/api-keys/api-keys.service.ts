import { timingSafeEqual } from 'node:crypto';
import { parseApiKey, type ApiKeySummary, type CreateApiKeyInput } from '@loglens/shared';
import type { Db } from '../../db/pool.js';
import { unauthenticated } from '../../http/errors.js';
import { randomToken, sha256Hex } from '../auth/crypto.js';
import { findApiKeyByPrefix, insertApiKey, type ApiKeyRecord } from './api-keys.repo.js';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const randomPrefix = (): string =>
  Array.from(randomToken(24))
    .filter((ch) => ALNUM.includes(ch))
    .slice(0, 8)
    .join('')
    .padEnd(8, 'x');

/** Creates a key and returns the plaintext exactly once; only its SHA-256 hash is stored. */
export async function createApiKey(
  db: Db,
  organizationId: string,
  userId: string,
  input: CreateApiKeyInput,
): Promise<{ key: ApiKeySummary; token: string }> {
  const prefix = randomPrefix();
  const token = `llk_${prefix}_${randomToken(32)}`;
  const key = await insertApiKey(db, {
    organizationId,
    name: input.name,
    prefix,
    keyHash: sha256Hex(token),
    defaultService: input.defaultService ?? null,
    createdBy: userId,
  });
  return { key, token };
}

/** Same work on every path (hash + constant-time compare) whether or not the prefix exists. */
const DUMMY_HASH = sha256Hex('llk_00000000_dummy');

export async function authenticateApiKey(db: Db, bearer: string | null): Promise<ApiKeyRecord> {
  const parsed = bearer ? parseApiKey(bearer) : null;
  const record = parsed ? await findApiKeyByPrefix(db, parsed.prefix) : null;
  const presented = Buffer.from(sha256Hex(parsed?.token ?? 'invalid'), 'hex');
  const expected = Buffer.from(record?.keyHash ?? DUMMY_HASH, 'hex');
  const matches = timingSafeEqual(presented, expected);
  if (!record || !matches || record.revoked)
    throw unauthenticated('A valid ingestion API key is required');
  return record;
}
