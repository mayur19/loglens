import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Histogram } from '../src/pages/search/Histogram';

const buckets = [
  { start: '2026-03-10T10:00:00.000Z', count: 2 },
  { start: '2026-03-10T10:05:00.000Z', count: 0 },
  { start: '2026-03-10T10:10:00.000Z', count: 8 },
];

describe('Histogram', () => {
  it('renders one bar per bucket scaled to the peak', () => {
    render(<Histogram buckets={buckets} bucketSeconds={300} width={300} height={118} />);
    const bars = screen.getAllByTestId('bar');
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => Number(b.getAttribute('height')))).toEqual([25, 0, 100]);
    expect(screen.getByRole('img')).toHaveAccessibleName('Event histogram, 3 buckets, peak 8');
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('uses dates for day-sized buckets and shows an empty state', () => {
    const { rerender } = render(
      <Histogram
        buckets={[{ start: '2026-03-10T00:00:00.000Z', count: 1 }]}
        bucketSeconds={86400}
      />,
    );
    expect(screen.getByText('03-10')).toBeInTheDocument();
    rerender(<Histogram buckets={[]} bucketSeconds={60} />);
    expect(screen.getByText('No events in range')).toBeInTheDocument();
  });
});
