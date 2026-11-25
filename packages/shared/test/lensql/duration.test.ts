import { describe, expect, it } from 'vitest';
import {
  LensQLError,
  parseDurationSeconds,
  resolveTimeExpression,
  resolveTimeRange,
  parseQuery,
} from '../../src/index.js';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const span = { start: 0, end: 1 };

describe('parseDurationSeconds', () => {
  it.each([
    ['30s', 30],
    ['10sec', 10],
    ['5m', 300],
    ['2min', 120],
    ['1h', 3600],
    ['7d', 604800],
    ['2w', 1209600],
  ])('%s → %d', (text, seconds) => {
    expect(parseDurationSeconds(text)).toBe(seconds);
  });

  it.each(['', '5', 'm', '1y', '-5m', '1.5h', '1234567m'])('rejects %s', (text) => {
    expect(parseDurationSeconds(text)).toBeNull();
  });
});

describe('resolveTimeExpression', () => {
  it('resolves now, relative offsets and ISO timestamps', () => {
    expect(resolveTimeExpression('NOW', NOW, span).toISOString()).toBe(NOW.toISOString());
    expect(resolveTimeExpression('-90s', NOW, span).toISOString()).toBe('2026-03-10T11:58:30.000Z');
    expect(resolveTimeExpression('-2d', NOW, span).toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(resolveTimeExpression('2026-03-01', NOW, span).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
    expect(resolveTimeExpression('2026-03-01T10:15:00+02:00', NOW, span).toISOString()).toBe(
      '2026-03-01T08:15:00.000Z',
    );
  });

  it('does not mutate the reference date', () => {
    const now = new Date(NOW.getTime());
    resolveTimeExpression('-1h', now, span);
    expect(now.getTime()).toBe(NOW.getTime());
  });

  it.each(['yesterday', '+5m', '2026-13-45', '2026-02-30T99:00Z'])(
    'rejects %s with TIME_RANGE_ERROR',
    (text) => {
      try {
        resolveTimeExpression(text, NOW, span);
        expect.unreachable();
      } catch (err) {
        expect((err as LensQLError).code).toBe('TIME_RANGE_ERROR');
      }
    },
  );
});

describe('resolveTimeRange', () => {
  const fallback = { from: new Date('2026-03-10T11:00:00Z'), to: NOW };

  it('uses the fallback range when the query has no bounds', () => {
    expect(resolveTimeRange(parseQuery('x'), fallback, NOW)).toEqual(fallback);
  });

  it('rejects an inverted fallback range', () => {
    expect(() => resolveTimeRange(parseQuery(''), { from: NOW, to: fallback.from }, NOW)).toThrow(
      /before its end/,
    );
  });
});
