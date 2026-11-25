import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type AppOptions } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db } from '../src/db/pool.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql:///loglens_test?host=/tmp';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: 'test-secret-that-is-at-least-thirty-two-chars',
      LOG_LEVEL: 'silent',
    }),
    ...overrides,
  };
}

/** Drops and recreates the public schema, then applies all migrations. */
export async function freshDatabase(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL, 5);
  await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}

export interface TestContext {
  readonly app: FastifyInstance;
  readonly db: Db;
}

export async function setupApp(
  options: Partial<Omit<AppOptions, 'db'>> = {},
): Promise<TestContext> {
  const db = await freshDatabase();
  const app = await buildApp({
    config: options.config ?? testConfig(),
    db,
    logger: false,
    ...options,
  });
  await app.ready();
  return { app, db };
}

export async function teardown(ctx: TestContext | undefined): Promise<void> {
  if (!ctx) return;
  await ctx.app.close();
  await ctx.db.end();
}

/** Minimal cookie-jar client that performs the CSRF double submit like the SPA does. */
export class Client {
  private cookies = new Map<string, string>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly headers: Record<string, string> = {},
  ) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: LightMyRequestResponse): void {
    for (const c of res.cookies as { name: string; value: string }[]) {
      if (c.value === '') this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }

  async csrf(): Promise<string> {
    if (!this.cookies.has('ll_csrf')) await this.request('GET', '/api/v1/auth/csrf');
    return this.cookies.get('ll_csrf') as string;
  }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...this.headers };
    if (method !== 'GET') headers['x-csrf-token'] = await this.csrf();
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const res = await this.app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    this.absorb(res);
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, payload: unknown = {}) => this.request('POST', url, payload);
  del = (url: string) => this.request('DELETE', url);
}

export const PASSWORD = 'correct-horse-battery-staple';

export async function registerAndLogin(
  app: FastifyInstance,
  email: string,
  org = 'Test Org',
): Promise<Client> {
  const client = new Client(app);
  const reg = await client.post('/api/v1/auth/register', {
    organizationName: org,
    name: 'Tess Tester',
    email,
    password: PASSWORD,
  });
  if (reg.statusCode !== 202) throw new Error(`register failed: ${reg.body}`);
  const login = await client.post('/api/v1/auth/login', { email, password: PASSWORD });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
  return client;
}
