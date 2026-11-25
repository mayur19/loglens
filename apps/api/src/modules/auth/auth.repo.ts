import type { Role } from '@loglens/shared';
import type { Db, DbClient } from '../../db/pool.js';

export interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly password_hash: string;
}

export interface SessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: Role;
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    'SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  return rows[0] ?? null;
}

export async function emailExists(client: DbClient, email: string): Promise<boolean> {
  const { rowCount } = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [
    email,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function createOrganizationWithOwner(
  client: DbClient,
  input: {
    organizationName: string;
    slug: string;
    name: string;
    email: string;
    passwordHash: string;
  },
): Promise<{ organizationId: string; userId: string }> {
  const org = await client.query<{ id: string }>(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [input.organizationName, input.slug],
  );
  const user = await client.query<{ id: string }>(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [input.email, input.name, input.passwordHash],
  );
  const organizationId = org.rows[0]?.id as string;
  const userId = user.rows[0]?.id as string;
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [organizationId, userId],
  );
  return { organizationId, userId };
}

export async function primaryMembership(
  db: Db,
  userId: string,
): Promise<{ organizationId: string; role: Role } | null> {
  const { rows } = await db.query<{ organization_id: string; role: Role }>(
    'SELECT organization_id, role FROM memberships WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
    [userId],
  );
  const row = rows[0];
  return row ? { organizationId: row.organization_id, role: row.role } : null;
}

export async function insertSession(
  db: Db,
  input: {
    tokenHash: string;
    userId: string;
    organizationId: string;
    expiresAt: Date;
    ip: string;
    userAgent: string | null;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sessions (token_hash, user_id, organization_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.tokenHash,
      input.userId,
      input.organizationId,
      input.expiresAt,
      input.ip,
      input.userAgent,
    ],
  );
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [input.userId]);
  return rows[0]?.id as string;
}

export async function findSession(db: Db, tokenHash: string): Promise<SessionContext | null> {
  const { rows } = await db.query<{
    session_id: string;
    user_id: string;
    email: string;
    name: string;
    organization_id: string;
    organization_name: string;
    role: Role;
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.name, o.id AS organization_id, o.name AS organization_name, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organizations o ON o.id = s.organization_id
       JOIN memberships m ON m.user_id = u.id AND m.organization_id = o.id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    sessionId: r.session_id,
    userId: r.user_id,
    email: r.email,
    name: r.name,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    role: r.role,
  };
}

export async function touchSession(db: Db, sessionId: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`,
    [sessionId],
  );
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
