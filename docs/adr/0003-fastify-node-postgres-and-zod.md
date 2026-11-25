# ADR-0003: Fastify 5, node-postgres and zod as a lean server stack

- **Status:** Accepted
- **Date:** 2026-11-20
- **Related:** ADR-0002, ADR-0011, LG-003

## Context

The API is I/O bound (PostgreSQL) and sits on the ingestion hot path, where per-request overhead matters (NFR-002, NFR-003). The project forbids third-party hosted services and asks for a lean dependency list. We need structured logging, cookie handling, content-type parsers for NDJSON, and schema validation at every boundary.

## Decision Drivers

- Low per-request overhead and built-in pino logging with redaction.
- Encapsulated plugin contexts (the ingest route needs its own NDJSON parser and body limit).
- Direct control over SQL: the LensQL compiler emits raw parameterised SQL, so an ORM adds no value.
- Runtime validation that also produces TypeScript types.

## Considered Options

1. **Fastify 5 + `pg` + zod + pino** — fast, schema-friendly, encapsulation model fits per-route parsers; `pg` passes arrays as parameters (needed for `unnest` bulk inserts and `text[]` attribute paths).
2. **Express 4 + helmet + an ORM (Prisma/TypeORM)** — familiar, but slower, no encapsulation, and ORMs fight both partitioned tables and compiler-emitted SQL.
3. **Query builder (Knex/Kysely)** — nicer than strings for CRUD, but the compiler already builds an AST-driven fragment tree; a builder would duplicate it and make parameter auditing harder.

## Decision Outcome

Chosen option 1. Runtime dependencies of the API are exactly: `fastify`, `@fastify/cookie`, `pg`, `pino`, `zod`, `@loglens/shared`. Rate limiting, CSRF, request IDs and security headers are implemented in-house (`apps/api/src/http/*`, `modules/auth/*`) because they are small and security-critical enough to own.

## Consequences

- **Positive:** small attack surface and audit scope; ingestion parser scoped with `app.register` so other routes keep strict JSON parsing.
- **Positive:** every SQL statement in the codebase is visible as a string and reviewable.
- **Negative:** repositories hand-map rows to domain objects; in-house security middleware must be tested thoroughly (see `apps/api/test/limiter.test.ts`, `app.http.test.ts`).
- **Negative:** Fastify's typings accept hop-count `trustProxy` only as a function, handled by `toFastifyTrustProxy` in `apps/api/src/app.ts`.
