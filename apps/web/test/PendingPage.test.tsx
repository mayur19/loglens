import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PendingPage } from '../src/pages/PendingPage';
import { plannedItems } from '../src/routes/navigation';

describe('PendingPage', () => {
  it('names the backlog ticket for a planned section', () => {
    const item = plannedItems()[0]!;
    render(<PendingPage item={item} />);
    expect(screen.getByRole('heading', { name: new RegExp(item.label) })).toBeInTheDocument();
    expect(screen.getByText(item.ticket!)).toBeInTheDocument();
  });
});
