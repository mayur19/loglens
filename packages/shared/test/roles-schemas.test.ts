import { describe, expect, it } from 'vitest';
import {
  fail,
  hasPermission,
  histogramRequestSchema,
  loginSchema,
  ok,
  registerSchema,
  ROLE_PERMISSIONS,
  ROLES,
  searchRequestSchema,
  createApiKeySchema,
} from '../src/index.js';

describe('roles', () => {
  it('grants strictly increasing permission sets', () => {
    const sizes = [...ROLES].reverse().map((r) => ROLE_PERMISSIONS[r].length);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(hasPermission('viewer', 'search:read')).toBe(true);
    expect(hasPermission('viewer', 'ingest:keys:manage')).toBe(false);
    expect(hasPermission('admin', 'ingest:keys:manage')).toBe(true);
    expect(hasPermission('admin', 'org:manage')).toBe(false);
    expect(hasPermission('owner', 'org:manage')).toBe(true);
  });
});

describe('envelope', () => {
  it('builds success and error envelopes', () => {
    expect(ok({ a: 1 })).toEqual({ data: { a: 1 }, error: null });
    expect(ok([], { total: 0 })).toEqual({ data: [], error: null, meta: { total: 0 } });
    expect(fail('X', 'y')).toEqual({ data: null, error: { code: 'X', message: 'y' } });
    expect(fail('X', 'y', { t: 1 })).toEqual({
      data: null,
      error: { code: 'X', message: 'y', details: { t: 1 } },
    });
  });
});

describe('schemas', () => {
  it('normalises emails and enforces password length on register', () => {
    const parsed = registerSchema.parse({
      organizationName: 'Acme',
      name: 'Ann',
      email: ' ANN@Acme.example ',
      password: 'correct horse battery',
    });
    expect(parsed.email).toBe('ann@acme.example');
    expect(
      registerSchema.safeParse({
        organizationName: 'Acme',
        name: 'Ann',
        email: 'ann@acme.example',
        password: 'short',
      }).success,
    ).toBe(false);
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });

  it('validates search and histogram requests strictly', () => {
    expect(searchRequestSchema.parse({})).toEqual({ query: '' });
    expect(searchRequestSchema.safeParse({ query: 'x', extra: 1 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ limit: 5000 }).success).toBe(false);
    expect(histogramRequestSchema.safeParse({ buckets: 0 }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ name: '' }).success).toBe(false);
  });
});
