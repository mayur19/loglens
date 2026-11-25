import type { Db } from './pool.js';

const DAY_MS = 86_400_000;

const toDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Ensures daily log_events partitions exist for [now - pastDays, now + futureDays].
 * Delegates to the idempotent SQL function created by migration 0002.
 */
export async function ensurePartitions(
  db: Db,
  now: Date,
  pastDays = 31,
  futureDays = 7,
): Promise<number> {
  const from = new Date(now.getTime() - pastDays * DAY_MS);
  const to = new Date(now.getTime() + futureDays * DAY_MS);
  const { rows } = await db.query<{ created: number }>(
    'SELECT loglens_ensure_daily_partitions($1::date, $2::date) AS created',
    [toDate(from), toDate(to)],
  );
  return Number(rows[0]?.created ?? 0);
}

/** Memoises partition maintenance to once per UTC day per process. */
export function createPartitionKeeper(db: Db) {
  let lastDay = '';
  return async (now: Date): Promise<void> => {
    const day = toDate(now);
    if (day === lastDay) return;
    await ensurePartitions(db, now);
    lastDay = day;
  };
}
