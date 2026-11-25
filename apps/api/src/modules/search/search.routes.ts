import {
  histogramRequestSchema,
  ok,
  searchRequestSchema,
  validateRequestSchema,
} from '@loglens/shared';
import type { FastifyInstance } from 'fastify';
import { authOf, requireAuth } from '../../http/auth-guard.js';
import { parseBody } from '../../http/validate.js';
import { histogram, search, validate, type SearchDeps } from './search.service.js';

export function registerSearchRoutes(app: FastifyInstance, deps: SearchDeps): void {
  const guard = { preHandler: requireAuth(deps.db, 'search:read') };

  app.post('/api/v1/search', guard, async (request) => {
    const input = parseBody(searchRequestSchema, request.body);
    const result = await search(deps, { ...input, organizationId: authOf(request).organizationId });
    return ok(result);
  });

  app.post('/api/v1/search/histogram', guard, async (request) => {
    const input = parseBody(histogramRequestSchema, request.body);
    return ok(await histogram(deps, { ...input, organizationId: authOf(request).organizationId }));
  });

  app.post('/api/v1/search/validate', guard, async (request) => {
    const { query } = parseBody(validateRequestSchema, request.body);
    return ok(validate(deps, authOf(request).organizationId, query));
  });
}
