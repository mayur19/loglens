import { describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError, readCookie } from '../src/api/client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readCookie', () => {
  it('finds and decodes cookies', () => {
    expect(readCookie('ll_csrf', 'a=1; ll_csrf=t%3Dk; b=2')).toBe('t=k');
    expect(readCookie('missing', 'a=1')).toBeNull();
  });
});

describe('apiRequest', () => {
  it('unwraps the data envelope on GET without a CSRF header', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { data: { ok: 1 }, error: null }));
    await expect(apiRequest('GET', '/x', undefined, fetcher)).resolves.toEqual({ ok: 1 });
    expect(fetcher.mock.calls[0]?.[1].headers['x-csrf-token']).toBeUndefined();
  });

  it('fetches a CSRF token before the first mutation and sends it', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: { csrfToken: 'tok' }, error: null }))
      .mockResolvedValueOnce(json(201, { data: { id: 1 }, error: null }));
    await apiRequest('POST', '/y', { a: 1 }, fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/auth/csrf');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"a":1}',
      headers: { 'x-csrf-token': 'tok', 'content-type': 'application/json' },
    });
  });

  it('throws ApiError with code and details from error envelopes', async () => {
    document.cookie = 'll_csrf=abc';
    const fetcher = vi.fn().mockResolvedValue(
      json(422, {
        data: null,
        error: { code: 'QUERY_INVALID', message: 'bad', details: { span: { start: 1, end: 2 } } },
      }),
    );
    const err = await apiRequest('POST', '/search', {}, fetcher).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422,
      code: 'QUERY_INVALID',
      details: { span: { start: 1, end: 2 } },
    });
  });

  it('reports non-JSON failures as network errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('oops', { status: 502 }));
    await expect(apiRequest('GET', '/z', undefined, fetcher)).rejects.toMatchObject({
      code: 'NETWORK',
      status: 502,
    });
  });
});
