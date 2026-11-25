import type { NormalizedEvent } from '@loglens/shared';
import type { Db } from '../../db/pool.js';

/**
 * Inserts a batch with a single statement: one array parameter per column expanded by unnest,
 * so a 5,000-event batch costs one round trip and one parse.
 */
export async function insertEvents(
  db: Db,
  organizationId: string,
  apiKeyId: string,
  defaultService: string | null,
  events: readonly NormalizedEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  const result = await db.query(
    `INSERT INTO log_events (organization_id, api_key_id, timestamp, level, service, host, source, message, trace_id, attributes)
     SELECT $1::uuid, $2::uuid, t.ts, t.level, t.service, t.host, t.source, t.message, t.trace_id, t.attributes
       FROM unnest($3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::jsonb[])
         AS t(ts, level, service, host, source, message, trace_id, attributes)`,
    [
      organizationId,
      apiKeyId,
      events.map((e) => e.timestamp),
      events.map((e) => e.level),
      events.map((e) => e.service ?? defaultService),
      events.map((e) => e.host),
      events.map((e) => e.source),
      events.map((e) => e.message),
      events.map((e) => e.traceId),
      events.map((e) => JSON.stringify(e.attributes)),
    ],
  );
  return result.rowCount ?? 0;
}
