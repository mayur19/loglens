export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface ApiEnvelope<T> {
  readonly data: T | null;
  readonly error: ApiErrorBody | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export const ok = <T>(data: T, meta?: Readonly<Record<string, unknown>>): ApiEnvelope<T> =>
  meta ? { data, error: null, meta } : { data, error: null };

export const fail = (code: string, message: string, details?: unknown): ApiEnvelope<never> => ({
  data: null,
  error: details === undefined ? { code, message } : { code, message, details },
});

export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  CSRF_INVALID: 'CSRF_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  QUERY_INVALID: 'QUERY_INVALID',
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',
  QUERY_FAILED: 'QUERY_FAILED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL: 'INTERNAL',
});
