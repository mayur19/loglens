import type { TimeRange } from './time-range.js';

/** "Nice" bucket widths in seconds, from one second to one week. */
export const BUCKET_STEPS: readonly number[] = Object.freeze([
  1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 604800,
]);

/** Smallest nice width that keeps the range within `targetBuckets` bars. O(|steps|). */
export function chooseBucketSeconds(range: TimeRange, targetBuckets: number): number {
  const seconds = Math.max(1, (range.to.getTime() - range.from.getTime()) / 1000);
  const ideal = seconds / Math.max(1, targetBuckets);
  return (
    BUCKET_STEPS.find((step) => step >= ideal) ?? (BUCKET_STEPS[BUCKET_STEPS.length - 1] as number)
  );
}

export interface HistogramBucket {
  readonly start: string;
  readonly count: number;
}

/** Floors a timestamp to a bucket boundary aligned to the Unix epoch (matches SQL date_bin). */
export const alignToBucket = (ms: number, bucketSeconds: number): number => {
  const width = bucketSeconds * 1000;
  return Math.floor(ms / width) * width;
};

/**
 * Produces a dense, gap-free series covering [from, to) from sparse database rows.
 * Rows outside the range are ignored; O(buckets + rows).
 */
export function fillHistogram(
  rows: readonly { readonly bucket: Date | string; readonly count: number | string }[],
  range: TimeRange,
  bucketSeconds: number,
): readonly HistogramBucket[] {
  const counts = new Map<number, number>(
    rows.map((r) => [alignToBucket(new Date(r.bucket).getTime(), bucketSeconds), Number(r.count)]),
  );
  const width = bucketSeconds * 1000;
  const first = alignToBucket(range.from.getTime(), bucketSeconds);
  const total = Math.ceil((range.to.getTime() - first) / width);
  return Array.from({ length: Math.max(0, total) }, (_, i) => {
    const start = first + i * width;
    return { start: new Date(start).toISOString(), count: counts.get(start) ?? 0 };
  });
}
