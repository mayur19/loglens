import { normalizeLevel, type LogLevel } from './levels.js';

export const INGEST_LIMITS = Object.freeze({
  maxMessageChars: 32_768,
  maxAttributesBytes: 16_384,
  maxAttributeDepth: 8,
  maxFieldChars: 256,
  maxFutureSkewMs: 10 * 60 * 1000,
  maxPastAgeMs: 30 * 86_400_000,
});

export interface NormalizedEvent {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string | null;
  readonly host: string | null;
  readonly source: string;
  readonly message: string;
  readonly traceId: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export type NormalizeResult =
  | { readonly ok: true; readonly event: NormalizedEvent }
  | { readonly ok: false; readonly reason: string };

const TIME_KEYS = ['timestamp', '@timestamp', 'time', 'ts'];
const LEVEL_KEYS = ['level', 'severity', 'lvl', 'loglevel'];
const SERVICE_KEYS = ['service', 'app', 'service.name'];
const HOST_KEYS = ['host', 'hostname'];
const MESSAGE_KEYS = ['message', 'msg', 'log'];
const TRACE_KEYS = ['trace_id', 'traceId', 'trace'];
const RESERVED = new Set([
  ...TIME_KEYS,
  ...LEVEL_KEYS,
  ...SERVICE_KEYS,
  ...HOST_KEYS,
  ...MESSAGE_KEYS,
  ...TRACE_KEYS,
]);

const pick = (obj: Record<string, unknown>, keys: readonly string[]): unknown =>
  keys.map((k) => obj[k]).find((v) => v !== undefined && v !== null);

const shortText = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text.slice(0, INGEST_LIMITS.maxFieldChars);
};

/** Accepts ISO strings, epoch seconds or epoch milliseconds. */
export function parseEventTime(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e11 ? value * 1000 : value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

const depthOf = (value: unknown, depth = 0): number => {
  if (depth > INGEST_LIMITS.maxAttributeDepth || value === null || typeof value !== 'object')
    return depth;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce<number>((max, child) => Math.max(max, depthOf(child, depth + 1)), depth);
};

interface TimeOutcome {
  readonly timestamp: Date;
  readonly flags: Readonly<Record<string, unknown>>;
}

function resolveTime(raw: unknown, receivedAt: Date): TimeOutcome | string {
  if (raw === undefined) return { timestamp: receivedAt, flags: {} };
  const parsed = parseEventTime(raw);
  if (!parsed) return 'unparseable timestamp';
  const delta = parsed.getTime() - receivedAt.getTime();
  if (delta > INGEST_LIMITS.maxFutureSkewMs) {
    return {
      timestamp: receivedAt,
      flags: { _clock_skew: true, _original_timestamp: String(raw) },
    };
  }
  if (-delta > INGEST_LIMITS.maxPastAgeMs)
    return 'timestamp is older than the 30 day ingestion window';
  return { timestamp: parsed, flags: {} };
}

/**
 * Maps one decoded JSON log record onto the LogLens event shape. Well-known keys become
 * columns; everything else is kept as attributes. Pure: never mutates `raw`.
 */
export function normalizeEvent(
  raw: unknown,
  receivedAt: Date,
  defaultSource = 'http',
): NormalizeResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'event must be a JSON object' };
  }
  const record = raw as Record<string, unknown>;
  const time = resolveTime(pick(record, TIME_KEYS), receivedAt);
  if (typeof time === 'string') return { ok: false, reason: time };

  const rawMessage = pick(record, MESSAGE_KEYS);
  const fullMessage =
    typeof rawMessage === 'string'
      ? rawMessage
      : rawMessage === undefined
        ? ''
        : JSON.stringify(rawMessage);
  const truncated = fullMessage.length > INGEST_LIMITS.maxMessageChars;
  const attributes = Object.fromEntries(
    Object.entries(record).filter(([k]) => !RESERVED.has(k) && k !== 'source'),
  );
  const merged = { ...attributes, ...time.flags, ...(truncated ? { _truncated: true } : {}) };

  if (depthOf(merged) > INGEST_LIMITS.maxAttributeDepth)
    return { ok: false, reason: 'attributes are nested too deeply' };
  if (new TextEncoder().encode(JSON.stringify(merged)).length > INGEST_LIMITS.maxAttributesBytes) {
    return { ok: false, reason: 'attributes exceed 16 KiB' };
  }
  return {
    ok: true,
    event: {
      timestamp: time.timestamp.toISOString(),
      level: normalizeLevel(pick(record, LEVEL_KEYS)),
      service: shortText(pick(record, SERVICE_KEYS)),
      host: shortText(pick(record, HOST_KEYS)),
      source: shortText(record.source) ?? defaultSource,
      message: truncated ? fullMessage.slice(0, INGEST_LIMITS.maxMessageChars) : fullMessage,
      traceId: shortText(pick(record, TRACE_KEYS)),
      attributes: merged,
    },
  };
}

export interface RejectedLine {
  readonly line: number;
  readonly reason: string;
}

export interface BatchParseResult {
  readonly events: readonly NormalizedEvent[];
  readonly rejected: readonly RejectedLine[];
}

/** Parses newline-delimited JSON. Blank lines are skipped; each bad line is reported, not fatal. */
export function parseNdjson(
  body: string,
  receivedAt: Date,
  maxEvents: number,
): BatchParseResult | { readonly tooMany: true } {
  const lines = body.split(/\r?\n/);
  const candidates = lines
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter((l) => l.text !== '');
  if (candidates.length > maxEvents) return { tooMany: true };
  const results = candidates.map(({ text, line }) => {
    try {
      const outcome = normalizeEvent(JSON.parse(text), receivedAt);
      return outcome.ok ? { event: outcome.event } : { rejected: { line, reason: outcome.reason } };
    } catch {
      return { rejected: { line, reason: 'invalid JSON' } };
    }
  });
  return {
    events: results.flatMap((r) => ('event' in r && r.event ? [r.event] : [])),
    rejected: results.flatMap((r) => ('rejected' in r && r.rejected ? [r.rejected] : [])),
  };
}
