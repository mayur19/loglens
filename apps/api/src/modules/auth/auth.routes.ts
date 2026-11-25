import { loginSchema, ok, registerSchema, ROLE_PERMISSIONS } from '@loglens/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../../db/pool.js';
import { authOf, requireAuth } from '../../http/auth-guard.js';
import {
  CSRF_COOKIE,
  csrfCookieFlags,
  SESSION_COOKIE,
  sessionCookieFlags,
} from '../../http/cookies.js';
import { parseBody } from '../../http/validate.js';
import { writeAudit } from '../audit/audit.repo.js';
import { deleteSession, findSession } from './auth.repo.js';
import { login, register, type AuthDeps, type RequestMeta } from './auth.service.js';
import { randomToken, sha256Hex } from './crypto.js';

export const metaOf = (request: FastifyRequest): RequestMeta => ({
  ip: request.ip,
  userAgent:
    typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  requestId: request.id,
});

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthDeps & { db: Db; secureCookies: boolean },
): void {
  app.get('/api/v1/auth/csrf', async (request, reply) => {
    const token = request.cookies[CSRF_COOKIE] ?? randomToken();
    void reply.setCookie(CSRF_COOKIE, token, csrfCookieFlags(deps.secureCookies));
    return ok({ csrfToken: token });
  });

  app.post('/api/v1/auth/register', async (request, reply) => {
    const input = parseBody(registerSchema, request.body);
    const result = await register(deps, input, metaOf(request));
    return reply.status(202).send(ok(result));
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const result = await login(deps, input, metaOf(request));
    void reply
      .setCookie(SESSION_COOKIE, result.token, {
        ...sessionCookieFlags(deps.secureCookies),
        expires: result.expiresAt,
      })
      .setCookie(CSRF_COOKIE, randomToken(), csrfCookieFlags(deps.secureCookies));
    const session = await findSession(deps.db, sha256Hex(result.token));
    return ok({ user: session ? toMe(session) : null, expiresAt: result.expiresAt.toISOString() });
  });

  app.post('/api/v1/auth/logout', { preHandler: requireAuth(deps.db) }, async (request, reply) => {
    const auth = authOf(request);
    await deleteSession(deps.db, auth.sessionId);
    await writeAudit(deps.db, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'auth.logout',
      ip: request.ip,
      requestId: request.id,
    });
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return ok({ loggedOut: true });
  });

  app.get('/api/v1/auth/me', { preHandler: requireAuth(deps.db) }, async (request) =>
    ok(toMe(authOf(request))),
  );
}

function toMe(auth: NonNullable<FastifyRequest['auth']>) {
  return {
    id: auth.userId,
    email: auth.email,
    name: auth.name,
    organization: { id: auth.organizationId, name: auth.organizationName },
    role: auth.role,
    permissions: ROLE_PERMISSIONS[auth.role],
  };
}
