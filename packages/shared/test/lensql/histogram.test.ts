import { describe, expect, it } from 'vitest';
import {
  alignToBucket,
  BUCKET_STEPS,
  chooseBucketSeconds,
  fillHistogram,
} from '../../src/index.js';

const range = (fromIso: string, toIso: string) => ({
  from: new Date(fromIso),
  to: new Date(toIso),
});

describe('chooseBucketSeconds', () => {
  it.each([
    [range('2026-01-01T00:00:00Z', '2026-01-01T00:15:00Z'), 60, 15],
    [range('2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'), 60, 60],
    [range('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'), 60, 1800],
    [range('2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z'), 60, 10800],
    [range('2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'), 60, 1],
  ])('picks a nice width for %#', (r, target, expected) => {
    expect(chooseBucketSeconds(r, target)).toBe(expected);
  });

  it('falls back to the widest step for enormous ranges', () => {
    const r = range('2000-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    expect(chooseBucketSeconds(r, 10)).toBe(BUCKET_STEPS[BUCKET_STEPS.length - 1]);
  });

  it('treats a zero target as one bucket', () => {
    expect(chooseBucketSeconds(range('2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'), 0)).toBe(60);
  });
});

describe('fillHistogram', () => {
  it('fills gaps with zero and aligns buckets to the epoch', () => {
    const r = range('2026-01-01T00:00:30Z', '2026-01-01T00:04:00Z');
    const series = fillHistogram(
      [
        { bucket: '2026-01-01T00:01:00Z', count: '4' },
        { bucket: new Date('2026-01-01T00:03:00Z'), count: 2 },
      ],
      r,
      60,
    );
    expect(series).toEqual([
      { start: '2026-01-01T00:00:00.000Z', count: 0 },
      { start: '2026-01-01T00:01:00.000Z', count: 4 },
      { start: '2026-01-01T00:02:00.000Z', count: 0 },
      { start: '2026-01-01T00:03:00.000Z', count: 2 },
    ]);
  });

  it('ignores rows outside the range and returns new objects', () => {
    const rows = [{ bucket: '2025-01-01T00:00:00Z', count: 9 }];
    const series = fillHistogram(rows, range('2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'), 5);
    expect(series.map((b) => b.count)).toEqual([0, 0]);
    expect(rows).toEqual([{ bucket: '2025-01-01T00:00:00Z', count: 9 }]);
  });

  it('returns an empty series for an empty range', () => {
    const at = '2026-01-01T00:00:00Z';
    expect(fillHistogram([], range(at, at), 60)).toEqual([]);
  });

  it('alignToBucket floors to multiples of the width', () => {
    expect(alignToBucket(Date.parse('2026-01-01T00:07:59Z'), 300)).toBe(
      Date.parse('2026-01-01T00:05:00Z'),
    );
  });
});
