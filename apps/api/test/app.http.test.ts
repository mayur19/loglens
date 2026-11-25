import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toFastifyTrustProxy } from '../src/app.js';
import { setupApp, teardown, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => teardown(ctx));

describe('platform endpoints', () => {
  it('reports health and readiness', async () => {
    const health = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toEqual({ data: { status: 'ok', version: '0.1.0' }, error: null });
    const ready = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data).toMatchObject({ status: 'ready', database: 'up', migrations: 2 });
  });

  it('echoes a well-formed request id and generates one otherwise', async () => {
    const echoed = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-12345678' },
    });
    expect(echoed.headers['x-request-id']).toBe('req-12345678');
    const assigned = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'bad id!' },
    });
    expect(assigned.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets defensive headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns enveloped 404s', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      data: null,
      error: { code: 'NOT_FOUND', message: 'Route GET /api/v1/nope not found' },
    });
  });

  it('rejects mutating API requests without a matching CSRF token', async () => {
    const missing = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.test', password: 'x' },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe('CSRF_INVALID');
    const mismatch = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { cookie: 'll_csrf=abc', 'x-csrf-token': 'abd' },
      payload: { email: 'a@b.test', password: 'x' },
    });
    expect(mismatch.statusCode).toBe(403);
  });

  it('maps malformed JSON to a validation envelope', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { cookie: 'll_csrf=abc', 'x-csrf-token': 'abc', 'content-type': 'application/json' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('readiness reports 503 when the database is unavailable', async () => {
    const broken = await setupApp();
    await broken.db.end();
    const res = await broken.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    await broken.app.close();
  });
});

describe('toFastifyTrustProxy', () => {
  it('converts hop counts into a hop-limited trust function', () => {
    const fn = toFastifyTrustProxy(1) as (a: string, h: number) => boolean;
    expect(fn('10.0.0.1', 0)).toBe(true);
    expect(fn('10.0.0.1', 1)).toBe(false);
    expect(toFastifyTrustProxy(false)).toBe(false);
    expect(toFastifyTrustProxy(['10.0.0.0/8'])).toEqual(['10.0.0.0/8']);
  });
});
