import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locates apps/api/migrations from source (src/db), the bundled CLI (dist/db) or a shared bundle
 * chunk (dist). MIGRATIONS_DIR overrides the search for unusual layouts.
 */
export function resolveMigrationsDir(env: NodeJS.ProcessEnv = process.env, from = HERE): string {
  if (env.MIGRATIONS_DIR) return path.resolve(env.MIGRATIONS_DIR);
  const candidates = ['../../migrations', '../migrations'].map((rel) => path.resolve(from, rel));
  const found = candidates.find((dir) => existsSync(path.join(dir, '0001_foundation.sql')));
  return found ?? (candidates[0] as string);
}

export const MIGRATIONS_DIR = resolveMigrationsDir();

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<readonly Migration[]> {
  const files = (await readdir(dir)).filter((f) => FILE_RE.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const match = FILE_RE.exec(file) as RegExpExecArray;
      const sql = await readFile(path.join(dir, file), 'utf8');
      return {
        version: match[1] as string,
        name: match[2] as string,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

export class MigrationChecksumError extends Error {}

/**
 * Forward-only runner: each pending migration runs in its own transaction; already-applied
 * migrations are verified by checksum so edited history is detected instead of silently ignored.
 * An advisory lock serialises concurrent runners.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<readonly string[]> {
  const migrations = await loadMigrations(dir);
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['loglens:migrate']);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const ran: string[] = [];
    for (const m of migrations) {
      const existing = applied.get(m.version);
      if (existing !== undefined) {
        if (existing !== m.checksum) {
          throw new MigrationChecksumError(
            `Migration ${m.version}_${m.name} was modified after being applied`,
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
        ran.push(`${m.version}_${m.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return ran;
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', ['loglens:migrate'])
      .catch(() => undefined);
    client.release();
  }
}
