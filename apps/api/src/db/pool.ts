import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(connectionString: string, max = 10): Db {
  return new pg.Pool({ connectionString, max, application_name: 'loglens-api' });
}

/** Runs `fn` inside a transaction, rolling back on any error. */
export async function withTransaction<T>(
  db: Db,
  fn: (client: DbClient) => Promise<T>,
  mode = 'BEGIN',
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query(mode);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
