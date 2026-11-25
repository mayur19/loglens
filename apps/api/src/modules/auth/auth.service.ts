import type { LoginInput, RegisterInput } from '@loglens/shared';
import { withTransaction, type Db } from '../../db/pool.js';
import { rateLimited, unauthenticated } from '../../http/errors.js';
import { writeAudit } from '../audit/audit.repo.js';
import {
  createOrganizationWithOwner,
  emailExists,
  findUserByEmail,
  insertSession,
  primaryMembership,
} from './auth.repo.js';
import { getDummyHash, hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto.js';
import type { LoginThrottle, RegisterThrottle } from './login-throttle.js';

export const REGISTER_ACCEPTED_MESSAGE =
  'If these details can be used, your workspace is ready. Sign in with your email and password to continue.';

export interface RequestMeta {
  readonly ip: string;
  readonly userAgent: string | null;
  readonly requestId: string;
}

export interface AuthDeps {
  readonly db: Db;
  readonly loginThrottle: LoginThrottle;
  readonly registerThrottle: RegisterThrottle;
  readonly sessionTtlHours: number;
  readonly now: () => number;
}

export const slugify = (name: string, suffix: string): string => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org';
  return `${base}-${suffix}`;
};

/**
 * Registers a new organization and its owner. The response is identical whether or not the email
 * is already taken (no account enumeration); a duplicate still pays the scrypt cost so timing does
 * not leak either. Email verification via the local outbox is tracked as LG-211.
 */
export async function register(
  deps: AuthDeps,
  input: RegisterInput,
  meta: RequestMeta,
): Promise<{ message: string }> {
  const decision = deps.registerThrottle.reserve(meta.ip, deps.now());
  if (!decision.allowed) throw rateLimited(decision.retryAfterMs);
  const passwordHash = await hashPassword(input.password);
  await withTransaction(deps.db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`register:${input.email}`]);
    if (await emailExists(client, input.email)) {
      await writeAudit(client, {
        organizationId: null,
        actorUserId: null,
        action: 'auth.register.duplicate',
        ip: meta.ip,
        requestId: meta.requestId,
      });
      return;
    }
    const created = await createOrganizationWithOwner(client, {
      organizationName: input.organizationName,
      slug: slugify(
        input.organizationName,
        randomToken(4)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, 'x'),
      ),
      name: input.name,
      email: input.email,
      passwordHash,
    });
    await writeAudit(client, {
      organizationId: created.organizationId,
      actorUserId: created.userId,
      action: 'auth.register',
      targetType: 'organization',
      targetId: created.organizationId,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  });
  return { message: REGISTER_ACCEPTED_MESSAGE };
}

export interface LoginResult {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Verifies credentials. The throttle reservation happens synchronously before the first await so
 * concurrent attempts are all counted; a success clears the email counter.
 */
export async function login(
  deps: AuthDeps,
  input: LoginInput,
  meta: RequestMeta,
): Promise<LoginResult> {
  const reservation = deps.loginThrottle.reserve(meta.ip, input.email, deps.now());
  if (!reservation.ok) throw rateLimited(reservation.retryAfterMs);

  const user = await findUserByEmail(deps.db, input.email);
  const valid = await verifyPassword(input.password, user?.password_hash ?? (await getDummyHash()));
  const membership = user && valid ? await primaryMembership(deps.db, user.id) : null;
  if (!user || !valid || !membership) {
    await writeAudit(deps.db, {
      organizationId: membership?.organizationId ?? null,
      actorUserId: user?.id ?? null,
      action: 'auth.login.failed',
      ip: meta.ip,
      requestId: meta.requestId,
    });
    throw unauthenticated('Invalid email or password');
  }
  deps.loginThrottle.succeed(reservation, deps.now());
  const token = randomToken();
  const expiresAt = new Date(deps.now() + deps.sessionTtlHours * 3_600_000);
  await insertSession(deps.db, {
    tokenHash: sha256Hex(token),
    userId: user.id,
    organizationId: membership.organizationId,
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 256) ?? null,
  });
  await writeAudit(deps.db, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: 'auth.login',
    ip: meta.ip,
    requestId: meta.requestId,
  });
  return { token, expiresAt };
}
