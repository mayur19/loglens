# ADR-0006: Tenant isolation by organization_id in repositories and in the compiler

- **Status:** Accepted
- **Date:** 2026-11-20
- **Related:** ADR-0011, NFR-006, LG-204

## Context

LogLens is multi-tenant: one installation hosts many organizations whose logs must never be visible to each other. Logs frequently contain sensitive data (user ids, IPs, error payloads). Users write arbitrary LensQL, including top-level `OR`, which is the classic way to escape a naively appended tenant filter (`WHERE tenant = 1 AND a OR b`).

## Decision Drivers

- Isolation must hold for user-authored queries, not only for hand-written repository SQL.
- Tenant id must come from the authenticated session or API key, never from request input.
- Partition pruning and index use should benefit from the tenant predicate.

## Considered Options

1. **Shared tables with `organization_id` on every row; scoping in repository functions; the LensQL compiler always emits the tenant predicate first and wraps the user filter in parentheses.**
2. **Schema-per-tenant** — strong isolation, but migrations × tenants, partition management × tenants, and connection search_path juggling.
3. **Database-per-tenant** — strongest isolation, operationally unrealistic for a single-node self-hosted product.
4. **PostgreSQL row-level security only** — enforced by the database, but requires per-request `SET` of tenant context and careful pooling; kept as defence in depth (LG-204).

## Decision Outcome

Chosen option 1. Every repository function takes `organizationId` as an explicit parameter (e.g. `listApiKeys(db, organizationId)`, `revokeApiKey(db, organizationId, id)`). For search, `basePredicate` in `packages/shared/src/lensql/compiler.ts` produces `e.organization_id = $?::uuid AND e.timestamp >= $? AND e.timestamp < $?`, and every user filter is compiled into a parenthesised fragment joined with `AND`; `assertContext` refuses a non-UUID tenant id before compiling. The organization id is taken from `request.auth` (session) or the API key record.

## Consequences

- **Positive:** tested end to end — a second tenant sees zero rows and a `count()` of 0 for the first tenant's data (`ingest-search.db.test.ts`), and compiler tests assert the tenant predicate precedes every filter including top-level `OR`.
- **Negative:** a forgotten parameter in a new repository function would leak data; mitigated by code review checklist and planned RLS (LG-204).
