import { z } from 'zod';

/**
 * TRUST_PROXY controls which X-Forwarded-For hops Fastify believes. It is never inferred from
 * NODE_ENV. Accepted values: `false` (default, trust nobody), a hop count (`1`), or a
 * comma-separated list of proxy IPs/CIDRs (`127.0.0.1,10.0.0.0/8`).
 */
export type TrustProxy = false | number | string[];

const CIDR_RE = /^[0-9a-fA-F:.]+(?:\/\d{1,3})?$/;

export function parseTrustProxy(raw: string | undefined): TrustProxy | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > 10) throw new Error('TRUST_PROXY hop count must be between 1 and 10');
    return hops;
  }
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0 || !list.every((entry) => CIDR_RE.test(entry))) {
    throw new Error(
      'TRUST_PROXY must be false, a hop count, or a comma-separated list of IPs/CIDRs',
    );
  }
  return list;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4109),
  WEB_ORIGIN: z.string().url().default('http://localhost:5109'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  TRUST_PROXY: z.string().optional(),
  QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  QUERY_MAX_ROWS: z.coerce.number().int().min(1).max(10_000).default(10_000),
  INGEST_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(52_428_800).default(5_242_880),
  INGEST_MAX_EVENTS_PER_REQUEST: z.coerce.number().int().min(1).max(50_000).default(5000),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly webOrigin: string;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  readonly sessionTtlHours: number;
  readonly trustProxy: TrustProxy;
  readonly queryTimeoutMs: number;
  readonly queryMaxRows: number;
  readonly ingestMaxBodyBytes: number;
  readonly ingestMaxEventsPerRequest: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validates process environment once at startup and fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  let trustProxy: TrustProxy | undefined;
  try {
    trustProxy = parseTrustProxy(e.TRUST_PROXY);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  if (e.NODE_ENV === 'production' && trustProxy === undefined) {
    throw new ConfigError(
      'TRUST_PROXY must be set explicitly in production (false, a hop count, or proxy IPs/CIDRs)',
    );
  }
  return {
    nodeEnv: e.NODE_ENV,
    host: e.API_HOST,
    port: e.API_PORT,
    webOrigin: e.WEB_ORIGIN,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    trustProxy: trustProxy ?? false,
    queryTimeoutMs: e.QUERY_TIMEOUT_MS,
    queryMaxRows: e.QUERY_MAX_ROWS,
    ingestMaxBodyBytes: e.INGEST_MAX_BODY_BYTES,
    ingestMaxEventsPerRequest: e.INGEST_MAX_EVENTS_PER_REQUEST,
  };
}
