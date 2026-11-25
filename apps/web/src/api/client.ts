import type { ApiEnvelope, ApiErrorBody } from '@loglens/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

const CSRF_COOKIE = 'll_csrf';

export function readCookie(name: string, cookieString: string = document.cookie): string | null {
  const match = cookieString
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfPromise: Promise<string> | null = null;

async function csrfToken(fetcher: typeof fetch): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  csrfPromise ??= fetcher('/api/v1/auth/csrf', { credentials: 'same-origin' })
    .then((r) => r.json() as Promise<ApiEnvelope<{ csrfToken: string }>>)
    .then((env) => env.data?.csrfToken ?? '')
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

/** Fetch wrapper: JSON in/out, CSRF header on mutations, envelope unwrapping into data or ApiError. */
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = await csrfToken(fetcher);
  const response = await fetcher(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !envelope || envelope.error) {
    throw new ApiError(
      response.status,
      envelope?.error ?? {
        code: 'NETWORK',
        message: `Request failed with status ${response.status}`,
      },
    );
  }
  return envelope.data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, body ?? {}),
  del: <T>(path: string) => apiRequest<T>('DELETE', path),
};
