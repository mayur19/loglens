import { ok, fail, ERROR_CODES } from '@loglens/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/pool.js';

export function registerHealthRoutes(app: FastifyInstance, db: Db, version: string): void {
  app.get('/health', async () => ok({ status: 'ok', version }));

  app.get('/ready', async (request, reply) => {
    try {
      const { rows } = await db.query<{ migrations: string }>(
        'SELECT count(*)::text AS migrations FROM schema_migrations',
      );
      return ok({ status: 'ready', database: 'up', migrations: Number(rows[0]?.migrations ?? 0) });
    } catch (err) {
      request.log.warn({ err }, 'readiness check failed');
      return reply
        .status(503)
        .send(fail(ERROR_CODES.INTERNAL, 'Database is not reachable or not migrated'));
    }
  });
}
