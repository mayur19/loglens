import { hasPermission, type Permission } from '@loglens/shared';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Db } from '../db/pool.js';
import { findSession, touchSession, type SessionContext } from '../modules/auth/auth.repo.js';
import { sha256Hex } from '../modules/auth/crypto.js';
import { SESSION_COOKIE } from './cookies.js';
import { forbidden, unauthenticated } from './errors.js';

export async function resolveSession(
  db: Db,
  request: FastifyRequest,
): Promise<SessionContext | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token || token.length > 128) return null;
  const session = await findSession(db, sha256Hex(token));
  if (session) await touchSession(db, session.sessionId);
  return session;
}

/** preHandler factory: requires a valid session and (optionally) an RBAC permission. */
export function requireAuth(db: Db, permission?: Permission): preHandlerAsyncHookHandler {
  return async (request) => {
    const session = await resolveSession(db, request);
    if (!session) throw unauthenticated();
    if (permission && !hasPermission(session.role, permission)) throw forbidden();
    request.auth = session;
  };
}

export const authOf = (request: FastifyRequest): SessionContext => {
  if (!request.auth) throw unauthenticated();
  return request.auth;
};
