import { ERROR_CODES } from '@loglens/shared';
import type { FastifyInstance } from 'fastify';
import { safeEqual } from '../modules/auth/crypto.js';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies.js';
import { AppError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Machine-to-machine endpoints authenticated by bearer API keys carry no ambient cookies. */
const EXEMPT_PREFIXES = ['/api/v1/ingest'];

/** Double-submit CSRF check for every state-changing browser request. */
export function registerCsrf(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return;
    const cookie = request.cookies[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];
    if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) {
      throw new AppError(403, ERROR_CODES.CSRF_INVALID, 'Missing or invalid CSRF token');
    }
  });
}
