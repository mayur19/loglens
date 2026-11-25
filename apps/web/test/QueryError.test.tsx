import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryError } from '../src/pages/search/QueryError';

describe('QueryError', () => {
  it('underlines the offending span of the query', () => {
    render(
      <QueryError
        query="level=error | bogus"
        error={{ message: "Unknown command 'bogus'", span: { start: 14, end: 19 } }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Unknown command 'bogus'");
    expect(screen.getByText('bogus').tagName).toBe('MARK');
  });

  it('marks at least one character for zero-width spans and handles missing spans', () => {
    const { rerender, container } = render(
      <QueryError query="a OR" error={{ message: 'x', span: { start: 4, end: 4 } }} />,
    );
    expect(container.querySelector('mark')?.textContent).toBe(' ');
    rerender(<QueryError query="a" error={{ message: 'plain' }} />);
    expect(container.querySelector('pre')).toBeNull();
  });
});
