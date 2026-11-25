import type { SessionContext } from '../modules/auth/auth.repo.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionContext | null;
  }
}

export {};
