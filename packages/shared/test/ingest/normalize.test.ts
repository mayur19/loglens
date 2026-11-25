import { describe, expect, it } from 'vitest';
import {
  INGEST_LIMITS,
  normalizeEvent,
  normalizeLevel,
  parseEventTime,
  parseNdjson,
} from '../../src/index.js';

const RECEIVED = new Date('2026-03-10T12:00:00.000Z');

describe('normalizeLevel', () => {
  it.each([
    ['ERROR', 'error'],
    [' Warning ', 'warn'],
    ['crit', 'fatal'],
    ['notice', 'info'],
    ['dbg', 'debug'],
    ['verbose', 'trace'],
    ['unknown', 'info'],
    [60, 'fatal'],
    [50, 'error'],
    [40, 'warn'],
    [30, 'info'],
    [20, 'debug'],
    [10, 'trace'],
    [-1, 'trace'],
    [null, 'info'],
    [Number.NaN, 'info'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeLevel(input)).toBe(expected);
  });
});

describe('parseEventTime', () => {
  it('accepts ISO strings, epoch seconds and epoch milliseconds', () => {
    expect(parseEventTime('2026-03-10T11:59:00Z')?.toISOString()).toBe('2026-03-10T11:59:00.000Z');
    expect(parseEventTime(1773143940)?.toISOString()).toBe('2026-03-10T11:59:00.000Z');
    expect(parseEventTime(1773143940000)?.toISOString()).toBe('2026-03-10T11:59:00.000Z');
  });

  it.each(['', 'not a date', {}, Number.POSITIVE_INFINITY, true])('rejects %s', (value) => {
    expect(parseEventTime(value)).toBeNull();
  });
});

describe('normalizeEvent', () => {
  it('maps well-known keys to columns and keeps the rest as attributes', () => {
    const raw = {
      ts: '2026-03-10T11:59:00Z',
      lvl: 'WARNING',
      app: 'checkout',
      hostname: 'web-1',
      msg: 'slow request',
      traceId: 'abc123',
      source: 'nginx',
      http: { status: 503, path: '/pay' },
      latency_ms: 812,
    };
    const result = normalizeEvent(raw, RECEIVED);
    expect(result).toEqual({
      ok: true,
      event: {
        timestamp: '2026-03-10T11:59:00.000Z',
        level: 'warn',
        service: 'checkout',
        host: 'web-1',
        source: 'nginx',
        message: 'slow request',
        traceId: 'abc123',
        attributes: { http: { status: 503, path: '/pay' }, latency_ms: 812 },
      },
    });
    expect(raw.lvl).toBe('WARNING');
  });

  it('defaults timestamp, level, source and stringifies non-string messages', () => {
    const result = normalizeEvent({ message: { nested: true } }, RECEIVED);
    expect(result.ok && result.event).toMatchObject({
      timestamp: RECEIVED.toISOString(),
      level: 'info',
      source: 'http',
      service: null,
      host: null,
      message: '{"nested":true}',
    });
    const empty = normalizeEvent({}, RECEIVED);
    expect(empty.ok && empty.event.message).toBe('');
  });

  it('clamps far-future timestamps and flags clock skew', () => {
    const result = normalizeEvent({ timestamp: '2026-03-10T13:00:00Z', message: 'x' }, RECEIVED);
    expect(result.ok && result.event.timestamp).toBe(RECEIVED.toISOString());
    expect(result.ok && result.event.attributes).toMatchObject({
      _clock_skew: true,
      _original_timestamp: '2026-03-10T13:00:00Z',
    });
  });

  it('truncates oversized messages and flags them', () => {
    const result = normalizeEvent(
      { message: 'x'.repeat(INGEST_LIMITS.maxMessageChars + 10) },
      RECEIVED,
    );
    expect(result.ok && result.event.message.length).toBe(INGEST_LIMITS.maxMessageChars);
    expect(result.ok && result.event.attributes._truncated).toBe(true);
  });

  it('truncates long column values and ignores blank ones', () => {
    const result = normalizeEvent(
      { service: 's'.repeat(400), host: '   ', message: 'm' },
      RECEIVED,
    );
    expect(result.ok && result.event.service?.length).toBe(INGEST_LIMITS.maxFieldChars);
    expect(result.ok && result.event.host).toBeNull();
  });

  it.each([
    [null, 'event must be a JSON object'],
    [[1, 2], 'event must be a JSON object'],
    ['text', 'event must be a JSON object'],
    [{ timestamp: 'garbage' }, 'unparseable timestamp'],
    [{ timestamp: '2025-01-01T00:00:00Z' }, 'older than the 30 day'],
    [{ a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } } }, 'nested too deeply'],
    [{ blob: 'x'.repeat(INGEST_LIMITS.maxAttributesBytes + 1) }, 'exceed 16 KiB'],
  ])('rejects %#', (raw, reason) => {
    const result = normalizeEvent(raw, RECEIVED);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain(reason);
  });
});

describe('parseNdjson', () => {
  it('parses valid lines, skips blanks and reports bad lines by number', () => {
    const body = [
      '{"message":"a"}',
      '',
      'not json',
      '{"message":"b","level":"error"}',
      '[1]',
      '  ',
    ].join('\n');
    const result = parseNdjson(body, RECEIVED, 10);
    if ('tooMany' in result) throw new Error('unexpected');
    expect(result.events.map((e) => e.message)).toEqual(['a', 'b']);
    expect(result.rejected).toEqual([
      { line: 3, reason: 'invalid JSON' },
      { line: 5, reason: 'event must be a JSON object' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const result = parseNdjson('{"message":"a"}\r\n{"message":"b"}\r\n', RECEIVED, 10);
    expect('events' in result && result.events.length).toBe(2);
  });

  it('refuses batches over the event cap', () => {
    expect(parseNdjson('{}\n{}\n{}', RECEIVED, 2)).toEqual({ tooMany: true });
  });
});
