import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PENDING_ROUTES } from '../src/modules/pending/pending.routes.js';
import { Client, registerAndLogin, setupApp, teardown, type TestContext } from './helpers.js';

let ctx: TestContext;
let client: Client;
beforeAll(async () => {
  ctx = await setupApp();
  client = await registerAndLogin(ctx.app, 'pending@test.test');
});
afterAll(() => teardown(ctx));

const concrete = (url: string) =>
  url.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');

describe('pending endpoints', () => {
  it.each(PENDING_ROUTES.map((r) => [r.method, r.url, r.ticket] as const))(
    '%s %s answers 501 with ticket %s',
    async (method, url, ticket) => {
      const res = await client.request(method, concrete(url), method === 'GET' ? undefined : {});
      expect(res.statusCode).toBe(501);
      expect(res.json()).toMatchObject({
        data: null,
        error: { code: 'NOT_IMPLEMENTED', details: { ticket } },
      });
    },
  );

  it('still requires authentication for non-auth pending endpoints', async () => {
    const anon = new Client(ctx.app);
    expect((await anon.get('/api/v1/dashboards')).statusCode).toBe(401);
    expect((await anon.post('/api/v1/auth/password-reset', {})).statusCode).toBe(501);
  });

  it('uses ticket ids in the LG-### format', () => {
    expect(PENDING_ROUTES.every((r) => /^LG-\d{3}$/.test(r.ticket))).toBe(true);
  });
});
