import { describe, expect, it } from 'vitest';
import { availableItems, NAV_ITEMS, plannedItems } from '../src/routes/navigation';

describe('navigation', () => {
  it('exposes the implemented slice and flags everything else as planned with a ticket', () => {
    expect(availableItems().map((i) => i.path)).toEqual(['/search', '/api-keys']);
    expect(plannedItems().length).toBe(NAV_ITEMS.length - 2);
    expect(plannedItems().every((i) => /^LG-\d{3}$/.test(i.ticket ?? ''))).toBe(true);
  });
});
