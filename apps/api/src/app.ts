import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import './http/types.js';
import type { AppConfig, TrustProxy } from './config/env.js';
import { createPartitionKeeper } from './db/partitions.js';
import type { Db } from './db/pool.js';
import { registerCsrf } from './http/csrf.js';
import { registerErrorHandler } from './http/error-handler.js';
import { registerApiKeyRoutes } from './modules/api-keys/api-keys.routes.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import {
  LoginThrottle,
  RegisterThrottle,
  type ThrottleOptions,
} from './modules/auth/login-throttle.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerIngestRoutes } from './modules/ingest/ingest.routes.js';
import { registerPendingRoutes } from './modules/pending/pending.routes.js';
import { registerSearchRoutes } from './modules/search/search.routes.js';

export const VERSION = '0.1.0';
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Fastify's typings accept hop counts only as a function: trust the nearest `n` hops. */
export const toFastifyTrustProxy = (
  value: TrustProxy,
): boolean | string[] | ((address: string, hop: number) => boolean) =>
  typeof value === 'number' ? (_address: string, hop: number) => hop < value : value;

export interface AppOptions {
  readonly config: AppConfig;
  readonly db: Db;
  readonly now?: () => Date;
  readonly throttle?: ThrottleOptions;
  readonly logger?: boolean;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const now = options.now ?? (() => new Date());
  const app = Fastify({
    trustProxy: toFastifyTrustProxy(config.trustProxy),
    bodyLimit: 1_048_576,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    },
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
            ],
          },
  });

  app.decorateRequest('auth', null);
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('cache-control', 'no-store');
  });

  await app.register(cookie);
  registerErrorHandler(app);
  registerCsrf(app);

  const secureCookies = config.nodeEnv === 'production';
  const loginThrottle = new LoginThrottle(app.log, options.throttle);
  const registerThrottle = new RegisterThrottle(app.log);

  registerHealthRoutes(app, db, VERSION);
  registerAuthRoutes(app, {
    db,
    loginThrottle,
    registerThrottle,
    sessionTtlHours: config.sessionTtlHours,
    now: () => now().getTime(),
    secureCookies,
  });
  registerApiKeyRoutes(app, db);
  registerIngestRoutes(app, {
    db,
    maxBodyBytes: config.ingestMaxBodyBytes,
    maxEvents: config.ingestMaxEventsPerRequest,
    ensurePartitions: createPartitionKeeper(db),
    now,
  });
  registerSearchRoutes(app, {
    db,
    timeoutMs: config.queryTimeoutMs,
    maxRows: config.queryMaxRows,
    now,
  });
  registerPendingRoutes(app, db);
  return app;
}
