import { ERROR_CODES, fail } from '@loglens/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from './errors.js';

/** Central error handler: maps every failure onto the JSON envelope without leaking internals. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      void reply
        .headers(err.headers)
        .status(err.statusCode)
        .send(fail(err.code, err.message, err.details));
      return;
    }
    const fe = err as FastifyError;
    if (fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      void reply.status(413).send(fail(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body is too large'));
      return;
    }
    if (
      fe.validation ||
      fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
      fe.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      (fe.statusCode === 400 && fe.code?.startsWith('FST_'))
    ) {
      void reply.status(fe.statusCode ?? 400).send(fail(ERROR_CODES.VALIDATION_ERROR, fe.message));
      return;
    }
    if (fe.statusCode === 415) {
      void reply.status(415).send(fail(ERROR_CODES.VALIDATION_ERROR, 'Unsupported content type'));
      return;
    }
    request.log.error({ err }, 'unhandled error');
    void reply.status(500).send(fail(ERROR_CODES.INTERNAL, 'An unexpected error occurred'));
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(
        fail(
          ERROR_CODES.NOT_FOUND,
          `Route ${request.method} ${request.url.split('?')[0]} not found`,
        ),
      );
  });
}
