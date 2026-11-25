import {
  extractBearer,
  ok,
  parseNdjson,
  normalizeEvent,
  ERROR_CODES,
  type BatchParseResult,
  type RejectedLine,
  type NormalizedEvent,
} from '@loglens/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/pool.js';
import { AppError, validationError } from '../../http/errors.js';
import { authenticateApiKey } from '../api-keys/api-keys.service.js';
import { markApiKeyUsed } from '../api-keys/api-keys.repo.js';
import { insertEvents } from './ingest.repo.js';

export interface IngestDeps {
  readonly db: Db;
  readonly maxBodyBytes: number;
  readonly maxEvents: number;
  readonly ensurePartitions: (now: Date) => Promise<void>;
  readonly now: () => Date;
}

const MAX_REPORTED_REJECTIONS = 50;

function parseJsonBody(body: unknown, receivedAt: Date, maxEvents: number): BatchParseResult {
  const items = Array.isArray(body) ? body : [body];
  if (items.length > maxEvents) throw tooMany(maxEvents);
  const outcomes = items.map((item, i) => ({
    line: i + 1,
    result: normalizeEvent(item, receivedAt),
  }));
  return {
    events: outcomes.flatMap((o) => (o.result.ok ? [o.result.event] : [])),
    rejected: outcomes.flatMap((o) =>
      o.result.ok ? [] : [{ line: o.line, reason: o.result.reason }],
    ),
  };
}

const tooMany = (max: number) =>
  new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, `A batch may contain at most ${max} events`);

/** Ingestion runs in its own encapsulated context so its content-type parsers do not leak. */
export function registerIngestRoutes(app: FastifyInstance, deps: IngestDeps): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      ['application/x-ndjson', 'application/jsonl', 'text/plain'],
      { parseAs: 'string', bodyLimit: deps.maxBodyBytes },
      (_req, body, done) => {
        done(null, body);
      },
    );

    scope.post('/api/v1/ingest', { bodyLimit: deps.maxBodyBytes }, async (request, reply) => {
      const key = await authenticateApiKey(deps.db, extractBearer(request.headers.authorization));
      const receivedAt = deps.now();
      let parsed: BatchParseResult;
      if (typeof request.body === 'string') {
        const result = parseNdjson(request.body, receivedAt, deps.maxEvents);
        if ('tooMany' in result) throw tooMany(deps.maxEvents);
        parsed = result;
      } else if (request.body !== undefined && request.body !== null) {
        parsed = parseJsonBody(request.body, receivedAt, deps.maxEvents);
      } else {
        throw validationError([], 'Request body must contain at least one event');
      }
      if (parsed.events.length === 0 && parsed.rejected.length === 0) {
        throw validationError([], 'Request body must contain at least one event');
      }
      await deps.ensurePartitions(receivedAt);
      const accepted = await insertEvents(
        deps.db,
        key.organizationId,
        key.id,
        key.defaultService,
        parsed.events as NormalizedEvent[],
      );
      await markApiKeyUsed(deps.db, key.id);
      const rejected: readonly RejectedLine[] = parsed.rejected.slice(0, MAX_REPORTED_REJECTIONS);
      return reply
        .status(202)
        .send(ok({ accepted, rejectedCount: parsed.rejected.length, rejected }));
    });
  });
}
