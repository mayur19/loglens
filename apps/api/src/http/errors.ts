import { ERROR_CODES } from '@loglens/shared';

/** Expected, client-facing failure. Anything else is treated as an internal error. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const unauthenticated = (message = 'Authentication required') =>
  new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, ERROR_CODES.FORBIDDEN, message);
export const notFound = (message = 'Resource not found') =>
  new AppError(404, ERROR_CODES.NOT_FOUND, message);
export const rateLimited = (retryAfterMs: number) =>
  new AppError(
    429,
    ERROR_CODES.RATE_LIMITED,
    'Too many attempts; try again later',
    { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
    {
      'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
    },
  );
export const validationError = (details: unknown, message = 'Request validation failed') =>
  new AppError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
