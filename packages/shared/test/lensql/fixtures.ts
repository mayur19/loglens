import type { CompileContext } from '../../src/index.js';

export const ORG = '0b9f3c1e-7a3d-4c2b-9f1e-2d4c6b8a0e11';
export const NOW = new Date('2026-03-10T12:00:00.000Z');

export const ctx = (overrides: Partial<CompileContext> = {}): CompileContext => ({
  organizationId: ORG,
  range: { from: new Date('2026-03-10T11:00:00.000Z'), to: NOW },
  now: NOW,
  defaultLimit: 100,
  maxRows: 1000,
  ...overrides,
});
