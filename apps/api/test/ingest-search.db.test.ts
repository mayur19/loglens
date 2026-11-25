import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/modules/auth/crypto.js';
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
let owner: Client;
let token: string;

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const range = { from: iso(120), to: new Date(now + 60_000).toISOString() };

const ingest = (
  body: string | object,
  contentType = 'application/x-ndjson',
  auth = `Bearer ${token}`,
) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/ingest',
    headers: { authorization: auth, 'content-type': contentType },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });

const search = async (query: string, extra: object = {}) => {
  const res = await owner.post('/api/v1/search', { query, ...range, ...extra });
  return { status: res.statusCode, body: res.json() };
};

const EVENTS = [
  {
    timestamp: iso(5),
    level: 'error',
    service: 'checkout',
    host: 'web-1',
    message: 'payment declined by processor',
    http: { status: 502, path: '/pay' },
    latency_ms: 950,
  },
  {
    timestamp: iso(6),
    level: 'error',
    service: 'checkout',
    host: 'web-2',
    message: 'upstream timeout',
    http: { status: 504, path: '/pay' },
    latency_ms: 3000,
  },
  {
    timestamp: iso(7),
    level: 'warn',
    service: 'checkout',
    host: 'web-1',
    message: 'slow request',
    http: { status: 200, path: '/cart' },
    latency_ms: 1200,
  },
  {
    timestamp: iso(8),
    level: 'info',
    service: 'auth',
    host: 'auth-1',
    message: 'user signed in',
    http: { status: '200', path: '/login' },
    latency_ms: 40,
    user: 'ann',
  },
  {
    timestamp: iso(9),
    level: 'info',
    service: 'auth',
    host: 'auth-1',
    message: '100% done_now',
    http: { status: 200, path: '/token' },
    latency_ms: 'n/a',
  },
  {
    timestamp: iso(70),
    level: 'debug',
    service: 'worker',
    host: 'worker-1',
    message: 'evaluating feature flags',
    region: 'eu-west-1',
  },
];

beforeAll(async () => {
  ctx = await setupApp({
    config: testConfig({ ingestMaxEventsPerRequest: 50, ingestMaxBodyBytes: 4096 }),
  });
  owner = await registerAndLogin(ctx.app, 'owner@search.test', 'Search Org');
  const created = await owner.post('/api/v1/api-keys', {
    name: 'shipper',
    defaultService: 'unknown-svc',
  });
  expect(created.statusCode).toBe(201);
  token = created.json().data.token;
  const res = await ingest(EVENTS.map((e) => JSON.stringify(e)).join('\n'));
  expect(res.statusCode).toBe(202);
});
afterAll(() => teardown(ctx));

describe('API keys', () => {
  it('returns the plaintext token once and stores only a hash', async () => {
    expect(token).toMatch(/^llk_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const list = await owner.get('/api/v1/api-keys');
    expect(list.json().data[0]).not.toHaveProperty('token');
    expect(list.json().meta).toEqual({ total: 1 });
    const { rows } = await ctx.db.query('SELECT key_hash FROM api_keys');
    expect(rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('records usage and audits creation', async () => {
    const list = await owner.get('/api/v1/api-keys');
    expect(list.json().data[0].lastUsedAt).not.toBeNull();
    const { rows } = await ctx.db.query(
      `SELECT action FROM audit_events WHERE action LIKE 'api_key.%'`,
    );
    expect(rows.map((r: { action: string }) => r.action)).toContain('api_key.create');
  });

  it('enforces RBAC: a viewer can search but cannot manage keys', async () => {
    const membership = await ctx.db.query(`SELECT organization_id FROM memberships LIMIT 1`);
    const user = await ctx.db.query(
      `INSERT INTO users (email, name, password_hash) VALUES ('viewer@search.test', 'Vee', $1) RETURNING id`,
      [await hashPassword(PASSWORD)],
    );
    await ctx.db.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [membership.rows[0].organization_id, user.rows[0].id],
    );
    const viewer = new Client(ctx.app);
    await viewer.post('/api/v1/auth/login', { email: 'viewer@search.test', password: PASSWORD });
    expect((await viewer.post('/api/v1/api-keys', { name: 'nope' })).statusCode).toBe(403);
    expect((await viewer.get('/api/v1/api-keys')).statusCode).toBe(403);
    expect(
      (await viewer.post('/api/v1/search', { query: 'level=error', ...range })).statusCode,
    ).toBe(200);
  });

  it('validates key creation and revocation ids', async () => {
    expect((await owner.post('/api/v1/api-keys', { name: '' })).statusCode).toBe(400);
    expect((await owner.del('/api/v1/api-keys/not-a-uuid')).statusCode).toBe(400);
    expect(
      (await owner.del('/api/v1/api-keys/00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });
});

describe('ingestion', () => {
  it('accepts JSON arrays and single objects and reports rejected entries', async () => {
    const res = await ingest(
      [
        { message: 'array one', level: 'info' },
        'not an object',
        { message: 'array two', timestamp: 'garbage' },
      ],
      'application/json',
    );
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toEqual({
      accepted: 1,
      rejectedCount: 2,
      rejected: [
        { line: 2, reason: 'event must be a JSON object' },
        { line: 3, reason: 'unparseable timestamp' },
      ],
    });
    const single = await ingest({ message: 'single object' }, 'application/json');
    expect(single.json().data.accepted).toBe(1);
  });

  it('applies the key default service when an event has none', async () => {
    const r = await search('"single object" | fields service');
    expect(r.body.data.rows[0].service).toBe('unknown-svc');
  });

  it('rejects missing, malformed, unknown and revoked keys with 401', async () => {
    expect((await ingest('{"message":"x"}', 'application/x-ndjson', '')).statusCode).toBe(401);
    expect(
      (await ingest('{"message":"x"}', 'application/x-ndjson', 'Bearer llk_garbage')).statusCode,
    ).toBe(401);
    const forged = `llk_${token.slice(4, 12)}_${'A'.repeat(43)}`;
    expect(
      (await ingest('{"message":"x"}', 'application/x-ndjson', `Bearer ${forged}`)).statusCode,
    ).toBe(401);
    const second = await owner.post('/api/v1/api-keys', { name: 'temp' });
    const tempToken = second.json().data.token;
    expect(
      (await ingest('{"message":"x"}', 'application/x-ndjson', `Bearer ${tempToken}`)).statusCode,
    ).toBe(202);
    const revoke = await owner.del(`/api/v1/api-keys/${second.json().data.id}`);
    expect(revoke.json().data.revokedAt).not.toBeNull();
    expect(
      (await ingest('{"message":"x"}', 'application/x-ndjson', `Bearer ${tempToken}`)).statusCode,
    ).toBe(401);
  });

  it('does not require CSRF tokens for bearer-authenticated ingestion', async () => {
    expect((await ingest('{"message":"no csrf needed"}')).statusCode).toBe(202);
  });

  it('enforces the event cap, body limit and non-empty bodies', async () => {
    const many = Array.from({ length: 51 }, () => '{}').join('\n');
    expect((await ingest(many)).statusCode).toBe(413);
    expect(
      (
        await ingest(
          Array.from({ length: 51 }, () => ({})),
          'application/json',
        )
      ).statusCode,
    ).toBe(413);
    const big = await ingest(`{"message":"${'x'.repeat(5000)}"}`);
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    expect((await ingest('\n\n')).statusCode).toBe(400);
  });

  it('writes into daily partitions, not the default partition', async () => {
    const { rows } = await ctx.db.query(
      `SELECT tableoid::regclass::text AS part, count(*)::int AS n FROM log_events GROUP BY 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: { part: string }) => /^log_events_p\d{8}$/.test(r.part))).toBe(true);
  });
});

describe('search', () => {
  it('returns newest events first with all columns', async () => {
    const r = await search('service=checkout');
    expect(r.status).toBe(200);
    expect(r.body.data.mode).toBe('events');
    expect(r.body.data.rows.map((e: { message: string }) => e.message)).toEqual([
      'payment declined by processor',
      'upstream timeout',
      'slow request',
    ]);
    expect(r.body.data.rows[0]).toMatchObject({
      level: 'error',
      host: 'web-1',
      attributes: { http: { status: 502 } },
    });
    expect(r.body.data.range).toEqual(range);
  });

  it('supports free text, boolean logic, wildcards and NOT', async () => {
    expect((await search('timeout OR declined')).body.data.rows).toHaveLength(2);
    expect((await search('host=web-* NOT level=warn')).body.data.rows).toHaveLength(2);
    expect((await search('"100% done_now"')).body.data.rows).toHaveLength(1);
    expect((await search('"100%"')).body.data.rows).toHaveLength(1);
    expect((await search('"done-now"')).body.data.rows).toHaveLength(0);
  });

  it('compares numeric attributes, including numeric strings, and skips non-numeric values', async () => {
    expect((await search('http.status>=500')).body.data.rows).toHaveLength(2);
    expect((await search('http.status=200 service=auth')).body.data.rows).toHaveLength(2);
    expect((await search('latency_ms<100')).body.data.rows).toHaveLength(1);
    expect((await search('status in (502, 504)')).body.data.rows).toHaveLength(0);
    expect((await search('http.status in (502, 504)')).body.data.rows).toHaveLength(2);
  });

  it('supports regex, existence and NOT over missing fields', async () => {
    expect((await search('message=~"^(upstream|payment)"')).body.data.rows).toHaveLength(2);
    expect((await search('user=*')).body.data.rows).toHaveLength(1);
    expect((await search('service=auth NOT user=ann')).body.data.rows).toHaveLength(1);
  });

  it('honours earliest/latest inside the query', async () => {
    const all = await search('service=worker', { from: iso(200) });
    expect(all.body.data.rows).toHaveLength(1);
    const recent = await search('earliest=-30m service=worker', { from: iso(200) });
    expect(recent.body.data.rows).toHaveLength(0);
  });

  it('computes grouped statistics with percentiles', async () => {
    const r = await search(
      '| stats count() as n, avg(latency_ms) as avg_ms, p50(latency_ms) by service | sort -n',
    );
    expect(r.body.data.mode).toBe('table');
    expect(r.body.data.columns.map((c: { name: string }) => c.name)).toEqual([
      'service',
      'n',
      'avg_ms',
      'p50(latency_ms)',
    ]);
    const checkout = r.body.data.rows.find(
      (row: { service: string }) => row.service === 'checkout',
    );
    expect(checkout).toMatchObject({
      n: 3,
      avg_ms: (950 + 3000 + 1200) / 3,
      'p50(latency_ms)': 1200,
    });
  });

  it('computes time-bucketed series and post-stats filters', async () => {
    const r = await search('level=error | stats count() by service span=1h');
    expect(r.body.data.columns[0]).toEqual({ name: '_time', type: 'time' });
    expect(r.body.data.rows[0]._time).toMatch(/T\d{2}:00:00.000Z$/);
    const filtered = await search(
      '| stats count() as n by host | where n>=2 AND host=* | sort host',
    );
    expect(filtered.body.data.rows.map((x: { host: string }) => x.host)).toEqual([
      'auth-1',
      'web-1',
    ]);
  });

  it('projects fields and caps rows with head', async () => {
    const r = await search('| fields service, http.path | head 2');
    expect(r.body.data.rows).toHaveLength(2);
    expect(Object.keys(r.body.data.rows[0])).toEqual(['id', 'timestamp', 'service', 'http.path']);
    expect(r.body.data.stats).toMatchObject({ rowCount: 2, limit: 2, truncated: true });
  });

  it('returns 422 with the error span for invalid queries', async () => {
    const r = await search('level=error | bogus');
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'QUERY_INVALID',
      details: { lensqlCode: 'PARSE_ERROR', span: { start: 14, end: 19 } },
    });
  });

  it('maps database-level regex errors to QUERY_FAILED', async () => {
    const r = await search('message=~"(unclosed"');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('QUERY_FAILED');
  });

  it('validates request bodies strictly', async () => {
    expect((await owner.post('/api/v1/search', { query: 'x', drop: true })).statusCode).toBe(400);
    expect((await owner.post('/api/v1/search', { query: 'x', from: 'yesterday' })).statusCode).toBe(
      400,
    );
  });

  it('requires authentication', async () => {
    const anon = new Client(ctx.app);
    expect((await anon.post('/api/v1/search', { query: '' })).statusCode).toBe(401);
  });
});

describe('histogram and validate', () => {
  it('returns a dense, gap-free series that sums to the hit count', async () => {
    const res = await owner.post('/api/v1/search/histogram', {
      query: 'service=checkout',
      ...range,
      buckets: 30,
    });
    const data = res.json().data;
    expect(data.bucketSeconds).toBe(300);
    expect(data.total).toBe(3);
    expect(data.buckets.length).toBeGreaterThanOrEqual(24);
    expect(data.buckets.reduce((s: number, b: { count: number }) => s + b.count, 0)).toBe(3);
  });

  it('reports invalid histogram queries as 422', async () => {
    const res = await owner.post('/api/v1/search/histogram', { query: 'a in (', ...range });
    expect(res.statusCode).toBe(422);
  });

  it('validates without executing', async () => {
    const good = await owner.post('/api/v1/search/validate', {
      query: 'level=error | stats count() by service',
    });
    expect(good.json().data).toEqual({ valid: true, mode: 'table', commands: ['stats'] });
    const bad = await owner.post('/api/v1/search/validate', { query: 'service>api' });
    expect(bad.json().data).toMatchObject({
      valid: false,
      error: { code: 'SEMANTIC_ERROR', span: { start: 0, end: 11 } },
    });
  });
});

describe('security of the query path', () => {
  const PAYLOADS = [
    `"'; DROP TABLE log_events; --"`,
    `message="x' OR '1'='1"`,
    `service="checkout'); DELETE FROM users; --"`,
    `| stats count() by service | where service="a' UNION SELECT password_hash FROM users --"`,
    `user.name="$$; TRUNCATE sessions; $$"`,
  ];

  it.each(PAYLOADS)('executes %s harmlessly against the real database', async (q) => {
    const r = await search(q);
    expect(r.status).toBe(200);
    expect(r.body.data.rows).toHaveLength(0);
  });

  it('left every table intact', async () => {
    const counts = await ctx.db.query(
      `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM sessions)::int AS sessions, (SELECT count(*) FROM log_events)::int AS events`,
    );
    expect(counts.rows[0].users).toBeGreaterThan(0);
    expect(counts.rows[0].sessions).toBeGreaterThan(0);
    expect(counts.rows[0].events).toBeGreaterThan(0);
  });

  it('isolates tenants: another organization sees none of these events', async () => {
    const other = await registerAndLogin(ctx.app, 'other@tenant.test', 'Other Tenant');
    const res = await other.post('/api/v1/search', { query: '', ...range });
    expect(res.json().data.rows).toHaveLength(0);
    const stats = await other.post('/api/v1/search', { query: '| stats count()', ...range });
    expect(stats.json().data.rows[0]['count()']).toBe(0);
  });
});

describe('query timeouts', () => {
  it('maps statement timeouts to QUERY_TIMEOUT', async () => {
    const org = await ctx.db.query(
      `SELECT organization_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'owner@search.test'`,
    );
    await ctx.db.query(
      `INSERT INTO log_events (organization_id, timestamp, level, service, message)
       SELECT $1, now() - (g || ' milliseconds')::interval, 'info', 'bulk', repeat(md5(g::text), 20) FROM generate_series(1, 30000) g`,
      [org.rows[0].organization_id],
    );
    const strict = await buildApp({
      config: testConfig({ queryTimeoutMs: 1 }),
      db: ctx.db,
      logger: false,
    });
    try {
      const client = new Client(strict);
      await client.post('/api/v1/auth/login', { email: 'owner@search.test', password: PASSWORD });
      const res = await client.post('/api/v1/search', {
        query: 'service=bulk message=~"(a|b|c|d)+(e|f)+z$" | stats dc(message)',
        ...range,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('QUERY_TIMEOUT');
    } finally {
      await strict.close();
    }
  });
});
