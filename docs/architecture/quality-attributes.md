# Quality attributes

Measurable targets for every non-functional requirement in [requirements.md](../product/requirements.md). "Verified today" lists automated checks that exist in the repository; "Planned verification" lists the ticket that will add the missing evidence. Measurements were taken on a developer laptop (Apple Silicon, PostgreSQL 17, seeded 20,000 events) unless stated otherwise.

## Summary

| NFR     | Attribute               | Target                                                           | Status                   |
| ------- | ----------------------- | ---------------------------------------------------------------- | ------------------------ |
| NFR-001 | Search latency          | p95 < 1.5 s, 1 h window, 10M events/tenant/day                   | Partially verified       |
| NFR-002 | Ingestion throughput    | ≥ 5,000 events/s per API instance                                | Target, unmeasured       |
| NFR-003 | Ingest acknowledgement  | p95 < 250 ms for a 1,000-event batch                             | Target, unmeasured       |
| NFR-004 | Query safety            | 100% user values parameterised; zero identifier interpolation    | Verified                 |
| NFR-005 | Bounded queries         | 5 s timeout, 10,000 rows, 90-day range, static limits            | Verified                 |
| NFR-006 | Tenant isolation        | Every statement scoped by `organization_id`                      | Verified                 |
| NFR-007 | Availability            | 99.5% monthly, single node                                       | Operational target       |
| NFR-008 | Durability              | RPO ≤ 24 h, RTO ≤ 2 h                                            | Procedure documented     |
| NFR-009 | Credential storage      | scrypt; 256-bit session tokens and API keys hashed at rest       | Verified                 |
| NFR-010 | Brute-force resistance  | Email backoff, IP spray limit, fan-out cap, registration limit   | Verified                 |
| NFR-011 | Observability           | Structured logs with request ids; secrets redacted               | Verified                 |
| NFR-012 | Test coverage           | ≥ 80% on implemented code                                        | Verified (≈98–99%)       |
| NFR-013 | Accessibility           | WCAG 2.1 AA on core screens                                      | Partially verified       |
| NFR-014 | Browser support         | Last two versions of evergreen browsers                          | Build target set         |
| NFR-015 | Portability             | No third-party services or containers; Node 22+, PostgreSQL 15+  | Verified                 |
| NFR-016 | Maintainability         | Strict TS; files < 400 lines; functions < 50 lines               | Verified                 |
| NFR-017 | Retention enforcement   | Data older than policy removed within 1 h of boundary            | Pending (LG-190, LG-191) |
| NFR-018 | Alert timeliness        | Alert fires within 2 evaluation intervals                        | Pending (LG-161, LG-167) |
| NFR-019 | Live tail latency       | < 2 s ingest-to-screen                                           | Pending (LG-140)         |
| NFR-020 | Fail-fast configuration | Invalid env aborts startup; `TRUST_PROXY` required in production | Verified                 |

## Details

### NFR-001 Search latency

- **Target:** p95 < 1.5 s for events or `stats` queries over a 1-hour window when the tenant ingests 10M events/day (~420k rows/hour).
- **Design levers:** tenant + time predicate first (partition pruning to one or two daily partitions), composite indexes `(organization_id, service|level, timestamp DESC)`, trigram index for free text, `LIMIT` pushed into SQL.
- **Verified today:** on the 20,000-event seed, `level=error | stats count() by service` returns in ~8 ms (`stats.elapsedMs` in the API response). Every response reports `elapsedMs` for ongoing observation.
- **Planned verification:** LG-221 seeds 10M events/day for 7 days and records p50/p95/p99 for a fixed query catalogue; LG-137 adds an `EXPLAIN`-based cost guard.

### NFR-002 Ingestion throughput and NFR-003 acknowledgement latency

- **Targets:** ≥ 5,000 events/s sustained per API instance; p95 ≤ 250 ms to acknowledge a 1,000-event NDJSON batch.
- **Design levers:** one `INSERT … SELECT FROM unnest(...)` per batch (ADR-0016), partition creation memoised per day, `last_used_at` updates throttled to once per minute.
- **Verified today:** functional tests only (`ingest-search.db.test.ts`).
- **Planned verification:** LG-102 benchmark harness (in-house load generator) and LG-101 COPY-based writer if the target is missed; LG-100 adds backpressure with `429 Retry-After` to protect latency under overload.

### NFR-004 Query safety

- **Target:** no user-controlled text in SQL statements; identifiers never interpolated.
- **Verified today:** `packages/shared/test/lensql/injection.test.ts` asserts that hostile payloads in every literal position never produce `DROP|DELETE|TRUNCATE|UNION|pg_sleep|--|/*|;` in the SQL text and are bound byte-for-byte as parameters; aliases and attribute paths are shown to map to compiler-assigned keys / `text[]` parameters. `apps/api/test/ingest-search.db.test.ts` executes injection payloads against PostgreSQL and confirms tables and rows survive. `sql()` throws if placeholder and parameter counts differ (ADR-0011).

### NFR-005 Bounded queries

- **Target:** statement timeout 5 s (configurable 100 ms–60 s), at most 10,000 rows, range ≤ 90 days, static limits from `limits.ts`.
- **Verified today:** limit tests in `lexer.test.ts`, `parser.test.ts`, `compiler.test.ts` (bucket budget, range, head cap); a 1 ms timeout produces `QUERY_TIMEOUT` (`ingest-search.db.test.ts`); searches run in `READ ONLY` transactions.

### NFR-006 Tenant isolation

- **Verified today:** compiler tests assert the tenant predicate precedes all filters, including top-level `OR`; integration tests show a second organization sees zero events and `count()` = 0; non-UUID tenant ids are rejected before compilation. **Planned:** PostgreSQL row-level security as defence in depth (LG-204).

### NFR-007 Availability

- **Target:** 99.5% monthly (≈ 3.6 h downtime) on a single node.
- **Means:** systemd restart policy, `/ready` endpoint for nginx/monitoring, forward-only migrations applied before restart. **Planned:** self-metrics endpoint (LG-220).

### NFR-008 Durability

- **Target:** RPO ≤ 24 h via nightly `pg_dump -Fc`; RTO ≤ 2 h for restore and restart.
- **Means:** documented in the [runbook](../operations/runbook.md). **Planned:** automated restore drill (LG-222).

### NFR-009 Credential storage

- **Verified today:** `crypto-ip.test.ts` (scrypt parameters, unique salts, malformed hash rejection); `auth.db.test.ts` asserts stored session tokens are 64-hex SHA-256 digests; `ingest-search.db.test.ts` asserts API key plaintext never appears in the database.

### NFR-010 Brute-force resistance

- **Target:** per-email progressive backoff (5 per 15 min, 1 s doubling to 15 min), per-IP spray limit (30 per 15 min), ≤ 20 distinct emails per IP per window, ≤ 5 registrations per IP per hour; bounded memory.
- **Verified today:** `limiter.test.ts` (backoff, caps, window reset, IPv6 /64 and IPv4-mapped normalisation, resumable sweep, least-time-left eviction with warning) and `auth.db.test.ts` (12 parallel bad logins → exactly 5 × 401 and 7 × 429; spraying blocked per IP while other IPs succeed; registration limited per IP). **Constraint:** single instance until LG-216.

### NFR-011 Observability

- **Verified today:** request-id echo and generation tested in `app.http.test.ts`; pino redaction paths configured in `apps/api/src/app.ts`. **Planned:** metrics endpoint (LG-220).

### NFR-012 Test coverage

- **Target:** ≥ 80% lines/statements on implemented code, enforced by Vitest thresholds.
- **Measured:** `packages/shared` ≈ 99.7% statements (thresholds 90/85), `apps/api` ≈ 98% statements (thresholds 80/75). CI runs `npm run test:coverage`.

### NFR-013 Accessibility and NFR-014 browser support

- **Today:** semantic HTML, labelled inputs, `role="alert"` for errors, the histogram is an `img` with an accessible name (tested in `Histogram.test.tsx`), visible focus outlines. Vite targets modern evergreen browsers. **Planned:** full audit with assistive technology (LG-224).

### NFR-015 Portability

- **Verified today:** CI uses the runner's preinstalled PostgreSQL started with `systemctl` (no service containers); runtime dependencies are limited to `fastify`, `@fastify/cookie`, `pg`, `pino`, `zod`; no outbound network calls.

### NFR-016 Maintainability

- **Verified today:** `strict`, `noUncheckedIndexedAccess` in `tsconfig.base.json`; ESLint and Prettier in CI; largest source file is under 250 lines.

### NFR-017 Retention, NFR-018 alert timeliness, NFR-019 live tail latency

- Designs recorded in ADR-0009, ADR-0017 and ADR-0018. Verification arrives with LG-191 (partition manager with simulated clock tests), LG-167 (alert evaluation suite with a simulated clock asserting firing within two ticks) and LG-140 (latency probe measuring ingest-to-WebSocket delivery).

### NFR-020 Fail-fast configuration

- **Verified today:** `env.test.ts` covers missing/invalid variables (all issues reported together), `TRUST_PROXY` parsing, and the production requirement that `TRUST_PROXY` be set explicitly.
