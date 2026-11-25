import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, MigrationChecksumError } from '../src/db/migrate.js';
import { ensurePartitions, createPartitionKeeper } from '../src/db/partitions.js';
import type { Db } from '../src/db/pool.js';
import { freshDatabase } from './helpers.js';
import { seed, DEMO } from '../src/db/seed.js';
import { buildDemoEvents, rng } from '../src/db/seed-data.js';

let db: Db;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(() => db.end());

describe('migration runner', () => {
  it('loads migrations in order with checksums', async () => {
    const migrations = await loadMigrations();
    expect(migrations.map((m) => m.version)).toEqual(['0001', '0002']);
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('detects edited migrations', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'loglens-mig-'));
    await writeFile(path.join(dir, '0001_foundation.sql'), 'SELECT 1;');
    await expect(migrate(db, dir)).rejects.toBeInstanceOf(MigrationChecksumError);
  });

  it('rolls back a failing migration and leaves no record', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'loglens-mig-'));
    const real = await loadMigrations();
    for (const m of real) await writeFile(path.join(dir, `${m.version}_${m.name}.sql`), m.sql);
    await writeFile(
      path.join(dir, '0099_broken.sql'),
      'CREATE TABLE broken_table (id int); SELECT * FROM missing_table;',
    );
    await expect(migrate(db, dir)).rejects.toThrow();
    const { rows } = await db.query(
      `SELECT to_regclass('broken_table') AS t, (SELECT count(*)::int FROM schema_migrations WHERE version = '0099') AS n`,
    );
    expect(rows[0]).toEqual({ t: null, n: 0 });
  });
});

describe('database invariants', () => {
  it('keeps the audit trail append-only', async () => {
    await db.query(`INSERT INTO audit_events (action) VALUES ('test.event')`);
    await expect(db.query(`UPDATE audit_events SET action = 'tampered'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
  });

  it('creates daily partitions idempotently and validates the window', async () => {
    const future = new Date(Date.now() + 60 * 86_400_000);
    expect(await ensurePartitions(db, future, 0, 1)).toBe(2);
    expect(await ensurePartitions(db, future, 0, 1)).toBe(0);
    await expect(
      db.query(`SELECT loglens_ensure_daily_partitions('2026-02-01', '2026-01-01')`),
    ).rejects.toThrow(/invalid partition window/);
    const keeper = createPartitionKeeper(db);
    await keeper(new Date());
    await keeper(new Date());
  });
});

describe('seed', () => {
  it('generates deterministic demo events', () => {
    const a = buildDemoEvents(new Date('2026-03-10T12:00:00Z'), 50);
    const b = buildDemoEvents(new Date('2026-03-10T12:00:00Z'), 50);
    expect(a).toEqual(b);
    expect(new Set(a.map((e) => e.service)).size).toBeGreaterThan(2);
    const r = rng(1);
    expect(r()).toBeGreaterThanOrEqual(0);
  });

  it('seeds once and is idempotent', async () => {
    const first = await seed(db);
    expect(first.events).toBe(DEMO.eventCount);
    expect((await seed(db)).events).toBe(0);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM log_events_default`);
    expect(rows[0].n).toBe(0);
  });
});

describe('resolveMigrationsDir', () => {
  it('finds migrations from source, bundle chunk and env override', async () => {
    const { resolveMigrationsDir } = await import('../src/db/migrate.js');
    const apiRoot = path.resolve(import.meta.dirname, '..');
    expect(resolveMigrationsDir({}, path.join(apiRoot, 'src/db'))).toBe(
      path.join(apiRoot, 'migrations'),
    );
    expect(resolveMigrationsDir({}, path.join(apiRoot, 'dist'))).toBe(
      path.join(apiRoot, 'migrations'),
    );
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: '/opt/x' }, apiRoot)).toBe('/opt/x');
  });
});
