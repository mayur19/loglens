import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTER_ACCEPTED_MESSAGE } from '../src/modules/auth/auth.service.js';
import {
  Client,
  PASSWORD,
  registerAndLogin,
  setupApp,
  teardown,
  testConfig,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  // Trust one proxy hop so tests can vary the client IP with X-Forwarded-For.
  ctx = await setupApp({ config: testConfig({ trustProxy: 1 }) });
});
afterAll(() => teardown(ctx));

const fromIp = (ip: string) => new Client(ctx.app, { 'x-forwarded-for': ip });

describe('registration', () => {
  it('creates an organization and owner, then allows sign-in', async () => {
    const client = await registerAndLogin(ctx.app, 'owner@one.test', 'One Corp');
    const me = await client.get('/api/v1/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({
      email: 'owner@one.test',
      role: 'owner',
      organization: { name: 'One Corp' },
    });
    expect(me.json().data.permissions).toContain('org:manage');
  });

  it('does not reveal whether an email is already registered', async () => {
    const body = { organizationName: 'Dup Corp', name: 'Dup', password: PASSWORD };
    const first = await fromIp('192.0.2.50').post('/api/v1/auth/register', {
      ...body,
      email: 'dup@acme.test',
    });
    const second = await fromIp('192.0.2.51').post('/api/v1/auth/register', {
      ...body,
      email: 'DUP@acme.test',
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(first.json().data.message).toBe(REGISTER_ACCEPTED_MESSAGE);
    const { rows } = await ctx.db.query(
      `SELECT count(*)::int AS n FROM users WHERE lower(email) = 'dup@acme.test'`,
    );
    expect(rows[0].n).toBe(1);
    const audit = await ctx.db.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.register.duplicate'`,
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('rate-limits registration per IP', async () => {
    const client = fromIp('192.0.2.77');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await client.post('/api/v1/auth/register', {
        organizationName: 'Spam',
        name: 'S',
        email: `spam${i}@x.test`,
        password: PASSWORD,
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses[5]).toBe(429);
  });

  it('validates input', async () => {
    const res = await fromIp('192.0.2.78').post('/api/v1/auth/register', {
      organizationName: 'X',
      name: '',
      email: 'nope',
      password: 'short',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });
});

describe('login, session and logout', () => {
  it('issues an HttpOnly SameSite=Lax session cookie and a readable CSRF cookie', async () => {
    await registerAndLogin(ctx.app, 'cookie@one.test');
    const client = new Client(ctx.app);
    const res = await client.post('/api/v1/auth/login', {
      email: 'cookie@one.test',
      password: PASSWORD,
    });
    const cookies = res.cookies as { name: string; httpOnly?: boolean; sameSite?: string }[];
    const session = cookies.find((c) => c.name === 'll_session');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Lax');
    expect(cookies.find((c) => c.name === 'll_csrf')?.httpOnly).toBeFalsy();
    const stored = await ctx.db.query('SELECT token_hash FROM sessions');
    expect(
      stored.rows.every((r: { token_hash: string }) => /^[0-9a-f]{64}$/.test(r.token_hash)),
    ).toBe(true);
  });

  it('rejects bad credentials with a generic message and audits the failure', async () => {
    const wrong = await fromIp('198.51.100.1').post('/api/v1/auth/login', {
      email: 'owner@one.test',
      password: 'wrong-password',
    });
    const unknown = await fromIp('198.51.100.2').post('/api/v1/auth/login', {
      email: 'ghost@one.test',
      password: 'wrong-password',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    const { rows } = await ctx.db.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'auth.login.failed'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('logs out and invalidates the session', async () => {
    const client = await registerAndLogin(ctx.app, 'bye@one.test');
    expect((await client.post('/api/v1/auth/logout')).statusCode).toBe(200);
    expect((await client.get('/api/v1/auth/me')).statusCode).toBe(401);
  });

  it('requires a session for /me and ignores forged cookies', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: 'll_session=forged' },
    });
    expect(res.statusCode).toBe(401);
    const long = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `ll_session=${'a'.repeat(200)}` },
    });
    expect(long.statusCode).toBe(401);
  });
});

describe('login throttling', () => {
  it('parallel bad logins for one account cannot all slip past the limiter', async () => {
    await registerAndLogin(ctx.app, 'target@one.test');
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        fromIp(`203.0.113.${i + 1}`).post('/api/v1/auth/login', {
          email: 'target@one.test',
          password: 'guess-guess',
        }),
      ),
    );
    const statuses = attempts.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
    const limited = attempts.find((r) => r.statusCode === 429);
    expect(limited?.headers['retry-after']).toBeDefined();
    expect(limited?.json().error.code).toBe('RATE_LIMITED');
  });

  it('a correct password is refused while the account is locked', async () => {
    const res = await fromIp('203.0.113.200').post('/api/v1/auth/login', {
      email: 'target@one.test',
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(429);
  });

  it('blocks one IP spraying many accounts but not other IPs', async () => {
    const sprayer = fromIp('203.0.113.250');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push(
        (
          await sprayer.post('/api/v1/auth/login', {
            email: `spray${i}@one.test`,
            password: 'Winter2026!',
          })
        ).statusCode,
      );
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
    const other = await fromIp('203.0.113.251').post('/api/v1/auth/login', {
      email: 'owner@one.test',
      password: PASSWORD,
    });
    expect(other.statusCode).toBe(200);
  });
});
