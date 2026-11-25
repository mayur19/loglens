import { createApiKeySchema, ok } from '@loglens/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/pool.js';
import { authOf, requireAuth } from '../../http/auth-guard.js';
import { notFound } from '../../http/errors.js';
import { parseBody } from '../../http/validate.js';
import { writeAudit } from '../audit/audit.repo.js';
import { listApiKeys, revokeApiKey } from './api-keys.repo.js';
import { createApiKey } from './api-keys.service.js';

const idParams = z.object({ id: z.string().uuid() });

export function registerApiKeyRoutes(app: FastifyInstance, db: Db): void {
  app.get(
    '/api/v1/api-keys',
    { preHandler: requireAuth(db, 'ingest:keys:read') },
    async (request) => {
      const keys = await listApiKeys(db, authOf(request).organizationId);
      return ok(keys, { total: keys.length });
    },
  );

  app.post(
    '/api/v1/api-keys',
    { preHandler: requireAuth(db, 'ingest:keys:manage') },
    async (request, reply) => {
      const auth = authOf(request);
      const input = parseBody(createApiKeySchema, request.body);
      const created = await createApiKey(db, auth.organizationId, auth.userId, input);
      await writeAudit(db, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'api_key.create',
        targetType: 'api_key',
        targetId: created.key.id,
        metadata: { name: created.key.name, prefix: created.key.prefix },
        ip: request.ip,
        requestId: request.id,
      });
      return reply.status(201).send(ok({ ...created.key, token: created.token }));
    },
  );

  app.delete(
    '/api/v1/api-keys/:id',
    { preHandler: requireAuth(db, 'ingest:keys:manage') },
    async (request) => {
      const auth = authOf(request);
      const { id } = parseBody(idParams, request.params);
      const revoked = await revokeApiKey(db, auth.organizationId, id);
      if (!revoked) throw notFound('API key not found');
      await writeAudit(db, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'api_key.revoke',
        targetType: 'api_key',
        targetId: id,
        ip: request.ip,
        requestId: request.id,
      });
      return ok(revoked);
    },
  );
}
