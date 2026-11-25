export interface HistogramProps {
  readonly buckets: readonly { readonly start: string; readonly count: number }[];
  readonly bucketSeconds: number;
  readonly width?: number;
  readonly height?: number;
}

const formatTick = (iso: string, bucketSeconds: number): string => {
  const d = new Date(iso);
  return bucketSeconds >= 86400 ? d.toISOString().slice(5, 10) : d.toISOString().slice(11, 16);
};

/** Dependency-free SVG bar chart of event counts over time. */
export function Histogram({ buckets, bucketSeconds, width = 960, height = 120 }: HistogramProps) {
  if (buckets.length === 0) return <div className="histogram-empty muted">No events in range</div>;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const barWidth = width / buckets.length;
  const plotHeight = height - 18;
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 6));
  return (
    <svg
      className="histogram"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Event histogram, ${buckets.length} buckets, peak ${max}`}
    >
      {buckets.map((b, i) => {
        const h = (b.count / max) * plotHeight;
        return (
          <rect
            key={b.start}
            data-testid="bar"
            x={i * barWidth + 1}
            y={plotHeight - h}
            width={Math.max(1, barWidth - 2)}
            height={h}
            className="bar"
          >
            <title>{`${b.start}: ${b.count}`}</title>
          </rect>
        );
      })}
      {buckets.map((b, i) =>
        i % tickEvery === 0 ? (
          <text key={`t-${b.start}`} x={i * barWidth} y={height - 4} className="tick">
            {formatTick(b.start, bucketSeconds)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
