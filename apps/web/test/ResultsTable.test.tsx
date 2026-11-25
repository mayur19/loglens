import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatCell, ResultsTable } from '../src/pages/search/ResultsTable';

describe('formatCell', () => {
  it('formats by column type', () => {
    expect(formatCell(null, 'text')).toBe('');
    expect(formatCell(3, 'number')).toBe('3');
    expect(formatCell(3.14159, 'number')).toBe('3.14');
    expect(formatCell('2026-03-10T10:00:00.000Z', 'time')).toBe('2026-03-10 10:00:00.000');
    expect(formatCell({ a: 1 }, 'text')).toBe('{"a":1}');
  });
});

describe('ResultsTable', () => {
  it('hides the id column, colours levels and right-aligns numbers', () => {
    render(
      <ResultsTable
        columns={[
          { name: 'id', type: 'text' },
          { name: 'level', type: 'text' },
          { name: 'count()', type: 'number' },
        ]}
        rows={[{ id: '1', level: 'error', 'count()': 12 }]}
      />,
    );
    expect(screen.queryByText('id')).not.toBeInTheDocument();
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('error')).toHaveClass('lvl-error');
    expect(within(row).getByText('12')).toHaveClass('num');
  });

  it('shows an empty state', () => {
    render(<ResultsTable columns={[]} rows={[]} />);
    expect(screen.getByText('No results.')).toBeInTheDocument();
  });
});
