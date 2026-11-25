/** Deterministic pseudo-random generator (mulberry32) so demo data is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERVICES = [
  { name: 'checkout', hosts: ['web-1', 'web-2'], paths: ['/cart', '/pay', '/confirm'] },
  {
    name: 'api-gateway',
    hosts: ['edge-1', 'edge-2', 'edge-3'],
    paths: ['/v1/orders', '/v1/users', '/v1/search'],
  },
  { name: 'billing', hosts: ['billing-1'], paths: ['/invoices', '/charges'] },
  { name: 'auth', hosts: ['auth-1', 'auth-2'], paths: ['/login', '/token', '/logout'] },
  { name: 'worker', hosts: ['worker-1'], paths: ['job:email', 'job:report', 'job:reindex'] },
];

const MESSAGES = {
  info: ['request completed', 'cache hit', 'job finished', 'user signed in', 'payment authorised'],
  warn: ['slow request', 'retrying upstream call', 'cache miss storm', 'deprecated endpoint used'],
  error: [
    'upstream timeout',
    'connection reset by peer',
    'payment declined by processor',
    'database deadlock detected',
  ],
  debug: ['evaluating feature flags', 'query plan selected'],
  fatal: ['out of memory: worker killed'],
} as const;

export interface DemoEvent {
  readonly timestamp: string;
  readonly level: keyof typeof MESSAGES;
  readonly service: string;
  readonly host: string;
  readonly message: string;
  readonly traceId: string;
  readonly attributes: Record<string, unknown>;
}

const pickOf = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)] as T;

function levelFor(rand: () => number, incident: boolean): DemoEvent['level'] {
  const r = rand();
  if (r < (incident ? 0.25 : 0.03)) return 'error';
  if (r < (incident ? 0.4 : 0.1)) return 'warn';
  if (r < 0.15) return 'debug';
  if (r > 0.9995) return 'fatal';
  return 'info';
}

/**
 * Builds `count` events spread over the last `hours`, with a simulated incident (error spike on
 * checkout + billing) about 40 minutes ago so the histogram and stats have something to show.
 */
export function buildDemoEvents(
  now: Date,
  count: number,
  hours = 24,
  seed = 42,
): readonly DemoEvent[] {
  const rand = rng(seed);
  const spanMs = hours * 3_600_000;
  return Array.from({ length: count }, () => {
    const ageMs = Math.floor(rand() * spanMs);
    const at = new Date(now.getTime() - ageMs);
    const svc = pickOf(rand, SERVICES);
    const incident =
      ageMs > 35 * 60_000 &&
      ageMs < 50 * 60_000 &&
      (svc.name === 'checkout' || svc.name === 'billing');
    const level = levelFor(rand, incident);
    const status =
      level === 'error'
        ? pickOf(rand, [500, 502, 503, 504])
        : level === 'warn'
          ? pickOf(rand, [200, 429])
          : pickOf(rand, [200, 200, 201, 204, 304]);
    const latency = Math.round(
      (level === 'error' ? 800 : 40) + rand() * (level === 'warn' ? 1500 : 300),
    );
    return {
      timestamp: at.toISOString(),
      level,
      service: svc.name,
      host: pickOf(rand, svc.hosts),
      message: pickOf(rand, MESSAGES[level]),
      traceId: Math.floor(rand() * 2 ** 48)
        .toString(16)
        .padStart(12, '0'),
      attributes: {
        http: {
          method: pickOf(rand, ['GET', 'GET', 'POST', 'PUT']),
          path: pickOf(rand, svc.paths),
          status,
        },
        latency_ms: latency,
        region: pickOf(rand, ['eu-west-1', 'us-east-1', 'ap-south-1']),
        user_id: `u-${Math.floor(rand() * 500)}`,
      },
    };
  });
}
