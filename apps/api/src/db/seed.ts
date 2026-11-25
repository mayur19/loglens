import { withTransaction, type Db } from './pool.js';
import { ensurePartitions } from './partitions.js';
import { buildDemoEvents } from './seed-data.js';
import { hashPassword, sha256Hex } from '../modules/auth/crypto.js';

export const DEMO = Object.freeze({
  organization: 'Acme Observability',
  slug: 'acme-observability',
  ownerEmail: 'owner@acme.test',
  viewerEmail: 'viewer@acme.test',
  password: 'loglens-demo-password',
  apiKey: 'llk_DemoKey1_' + 'd'.repeat(43),
  eventCount: 20_000,
});

/** Idempotent demo seed: one org, an owner and a viewer, one ingestion key, 24h of events. */
export async function seed(db: Db, now = new Date()): Promise<{ events: number }> {
  await ensurePartitions(db, now);
  const passwordHash = await hashPassword(DEMO.password);
  return withTransaction(db, async (client) => {
    const existing = await client.query('SELECT id FROM organizations WHERE slug = $1', [
      DEMO.slug,
    ]);
    if ((existing.rowCount ?? 0) > 0) return { events: 0 };
    const org = await client.query<{ id: string }>(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
      [DEMO.organization, DEMO.slug],
    );
    const orgId = org.rows[0]?.id as string;
    for (const [email, name, role] of [
      [DEMO.ownerEmail, 'Olivia Owner', 'owner'],
      [DEMO.viewerEmail, 'Victor Viewer', 'viewer'],
    ] as const) {
      const user = await client.query<{ id: string }>(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [email, name, passwordHash],
      );
      await client.query(
        'INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)',
        [orgId, user.rows[0]?.id, role],
      );
    }
    const key = await client.query<{ id: string }>(
      `INSERT INTO api_keys (organization_id, name, prefix, key_hash, default_service) VALUES ($1, 'Demo shipper', 'DemoKey1', $2, NULL) RETURNING id`,
      [orgId, sha256Hex(DEMO.apiKey)],
    );
    const events = buildDemoEvents(now, DEMO.eventCount);
    const batchSize = 2000;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      await client.query(
        `INSERT INTO log_events (organization_id, api_key_id, timestamp, level, service, host, source, message, trace_id, attributes)
         SELECT $1::uuid, $2::uuid, t.ts, t.level, t.service, t.host, 'seed', t.message, t.trace_id, t.attributes
           FROM unnest($3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::jsonb[])
             AS t(ts, level, service, host, message, trace_id, attributes)`,
        [
          orgId,
          key.rows[0]?.id,
          batch.map((e) => e.timestamp),
          batch.map((e) => e.level),
          batch.map((e) => e.service),
          batch.map((e) => e.host),
          batch.map((e) => e.message),
          batch.map((e) => e.traceId),
          batch.map((e) => JSON.stringify(e.attributes)),
        ],
      );
    }
    return { events: events.length };
  });
}
