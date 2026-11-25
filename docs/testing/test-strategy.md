# Test Strategy

LogLens puts most of its correctness risk in two places: the LensQL compiler, where a bug can be a data leak or an injection, and the boundary between the API and PostgreSQL, where a bug can be a tenant leak, a partitioning issue or a timeout. The test suite is weighted to match.

## 1. Pyramid

```mermaid
flowchart TB
  E2E["E2E smoke (Playwright) — 2 specs, opt-in"]
  INT["API integration against real PostgreSQL — ~110 tests"]
  UNIT["Unit — shared domain 228, API units ~50, web components 14"]
  E2E --> INT --> UNIT
```

| Layer                                                         | Count (0.1.0) | Runtime | Runs in CI                             |
| ------------------------------------------------------------- | ------------- | ------- | -------------------------------------- |
| `packages/shared` unit (Vitest, node)                         | 228           | < 1 s   | yes                                    |
| `apps/api` unit + integration (Vitest, real Postgres)         | 159           | ~10 s   | yes                                    |
| `apps/web` components (Vitest + React Testing Library, jsdom) | 14            | ~2 s    | yes                                    |
| `e2e` smoke (Playwright)                                      | 2             | ~10 s   | no (no browsers on the runner; LG-223) |

All 401 automated tests pass locally and in CI.

## 2. What is tested where

### packages/shared (pure logic, no I/O)

| File                            | Focus                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/lensql/lexer.test.ts`     | Token types, spans, every operator, string escapes, NUL rejection, query/token/string length limits                                                                                                               |
| `test/lensql/parser.test.ts`    | Precedence (AND over OR, implicit AND, NOT, parentheses), literals, regex/IN/existence, `earliest`/`latest` lifting, every command, about 30 rejection cases with exact messages and spans, depth and size limits |
| `test/lensql/compiler.test.ts`  | Exact SQL text and parameter lists for events mode, stats mode, post-stats where/sort/head, projections, every aggregate, time buckets, semantic errors, row caps                                                 |
| `test/lensql/injection.test.ts` | Adversarial payloads (§5)                                                                                                                                                                                         |
| `test/lensql/histogram.test.ts` | Nice bucket selection, epoch alignment, dense gap filling, immutability                                                                                                                                           |
| `test/lensql/duration.test.ts`  | Durations, relative and ISO times, time-range validation                                                                                                                                                          |
| `test/ingest/normalize.test.ts` | Level aliases (including pino numbers), timestamp formats, clock-skew clamping, truncation, depth and size limits, NDJSON line reporting                                                                          |
| `test/ingest/api-key.test.ts`   | Key format parsing, bearer extraction                                                                                                                                                                             |
| `test/roles-schemas.test.ts`    | Role hierarchy, envelope helpers, zod schemas                                                                                                                                                                     |

### apps/api

| File                            | Kind        | Focus                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/env.test.ts`              | unit        | Defaults, aggregated errors, `TRUST_PROXY` parsing, production requiring `TRUST_PROXY`                                                                                                                                                                                                                                                                                                      |
| `test/crypto-ip.test.ts`        | unit        | scrypt round trip, salts, malformed hashes, constant-time compare, IPv4-mapped and IPv6 /64 normalisation                                                                                                                                                                                                                                                                                   |
| `test/limiter.test.ts`          | unit        | Progressive backoff and cap, windows, release/reset, bounded store sweep cursor, eviction of the least-time-left entry with a warning, email-across-IPs lock, IP spray lock, distinct-email cap, synchronous reservation, registration limiter                                                                                                                                              |
| `test/app.http.test.ts`         | integration | Health and readiness (including 503 when the DB is down), request IDs, security headers, 404 envelope, CSRF rejection, malformed JSON                                                                                                                                                                                                                                                       |
| `test/auth.db.test.ts`          | integration | Registration, non-enumeration (identical responses, single user row, duplicate audited), registration IP limit, cookie flags, hashed tokens, generic login failures, logout, forged cookies, **12 parallel bad logins → exactly 5×401 and 7×429**, lockout of a correct password, IP spraying                                                                                               |
| `test/ingest-search.db.test.ts` | integration | Keys hashed at rest, RBAC (viewer), ingestion of NDJSON/JSON/object, per-line rejections, default service, bad/forged/revoked keys, CSRF exemption, size and count limits, daily partition routing, every search feature against real data, 422 spans, regex errors at execution, statement timeout, histogram sums, validate, injection payloads executed against the DB, tenant isolation |
| `test/pending.http.test.ts`     | integration | Every route in `PENDING_ROUTES` returns 501 with its `LG-###` ticket and still requires authentication                                                                                                                                                                                                                                                                                      |
| `test/migrate.db.test.ts`       | integration | Ordering, idempotency, checksum mismatch, rollback of a failing migration, append-only audit, partition function idempotency and window validation, deterministic and idempotent seed, nothing in `log_events_default`                                                                                                                                                                      |

### apps/web

| File                                                   | Focus                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `test/Histogram.test.tsx`                              | Bar scaling, accessible name, tick formats, empty state                                  |
| `test/ResultsTable.test.tsx`                           | Cell formatting, hidden `id`, level colouring, numeric alignment                         |
| `test/QueryError.test.tsx`                             | Span underline, zero-width spans, missing span                                           |
| `test/client.test.ts`                                  | CSRF fetch before the first mutation, envelope unwrapping, `ApiError`, non-JSON failures |
| `test/navigation.test.ts`, `test/PendingPage.test.tsx` | Planned sections carry tickets                                                           |

## 3. Integration tests against real PostgreSQL

The API and the database are tested together; they are never mocked apart. The compiler emits PostgreSQL-specific SQL (`date_bin`, `jsonb_typeof`, `percentile_cont`, `ILIKE ... ESCAPE`, ARE regex), so only a real server proves it runs.

- The connection string comes from `TEST_DATABASE_URL`. The local default is `postgresql:///loglens_test?host=/tmp` (unix socket, current OS user). CI uses `postgresql://loglens:loglens@localhost:5432/loglens_test` against the runner's preinstalled PostgreSQL, started with `systemctl` (no containers).
- `freshDatabase()` in `apps/api/test/helpers.ts` runs `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` and then the real migration runner, so every file starts from the production schema.
- Files run **sequentially** (`fileParallelism: false` in `apps/api/vitest.config.ts`) because they share one database. Within a file, tests share state on purpose: ingested fixtures are reused by later search assertions.
- Apps are built with `buildApp({ logger: false })` and driven with `app.inject`. The `Client` helper keeps a cookie jar and performs the CSRF double submit like the SPA does.
- To vary client IPs, tests set `trustProxy: 1` and send `X-Forwarded-For`, which also exercises `toFastifyTrustProxy`.

## 4. Coverage thresholds

Thresholds apply to implemented code only. Pending features have no code, only 501 stubs.

| Package           | Thresholds (lines / functions / branches / statements)              | Actual (0.1.0)                     |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------- |
| `packages/shared` | 90 / 90 / 85 / 90                                                   | 99.7 % statements, 98.1 % branches |
| `apps/api`        | 80 / 80 / 75 / 80 (excludes `index.ts`, `db/cli.ts`, `db/seed*.ts`) | 98.1 % statements, 91.5 % branches |
| `apps/web`        | reported, no gate yet                                               | —                                  |

CI runs `npm run test:coverage`, which fails the build if any threshold is missed.

## 5. Adversarial and injection testing

`packages/shared/test/lensql/injection.test.ts` puts ten hostile payloads through six syntactic positions each: free text, column compare, attribute compare, IN list, regex and post-stats where. Each check asserts that:

1. the SQL text matches none of `DROP|DELETE|TRUNCATE|UNION|pg_sleep|password_hash|current_user|--|/*|;`;
2. exact comparisons bind the payload byte-for-byte as a parameter;
3. unquoted SQL syntax (`;`, `'`) fails in the lexer;
4. hostile field paths are rejected or bound as `text[]`;
5. user aliases never reach SQL;
6. very large numbers stay strings cast to `numeric`;
7. every statement starts with the tenant and time predicate, even with a top-level `OR`.

`apps/api/test/ingest-search.db.test.ts` then **executes** five payloads against PostgreSQL and verifies that `users`, `sessions` and `log_events` still exist and hold data. It also checks that a second organization sees none of the first organization's events, in both events and stats mode.

## 6. Acceptance test matrix

| FR         | Requirement                                      | Test(s)                                                                                                           |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| FR-001     | Register organization owner                      | `auth.db.test.ts` › creates an organization and owner                                                             |
| FR-002     | Login                                            | `auth.db.test.ts` › issues an HttpOnly … cookie                                                                   |
| FR-003     | Logout                                           | `auth.db.test.ts` › logs out and invalidates the session                                                          |
| FR-004     | Current user                                     | `auth.db.test.ts` › creates an organization …, requires a session for /me                                         |
| FR-005     | Sessions hashed, expiring                        | `auth.db.test.ts` › stored token hashes                                                                           |
| FR-006     | CSRF                                             | `app.http.test.ts` › rejects mutating API requests …                                                              |
| FR-007     | RBAC                                             | `ingest-search.db.test.ts` › enforces RBAC                                                                        |
| FR-008     | Audit trail                                      | `auth.db.test.ts` (failed logins, duplicates), `migrate.db.test.ts` › append-only                                 |
| FR-009–011 | Create / list / revoke keys                      | `ingest-search.db.test.ts` › API keys, rejects … revoked keys                                                     |
| FR-012     | NDJSON/JSON ingest                               | `ingest-search.db.test.ts` › accepts JSON arrays and single objects                                               |
| FR-013     | Normalisation                                    | `normalize.test.ts`                                                                                               |
| FR-014     | Per-line rejection, partitions                   | `ingest-search.db.test.ts` › reports rejected entries, writes into daily partitions                               |
| FR-015–020 | Text, comparisons, boolean, regex, IN, existence | `parser.test.ts`, `compiler.test.ts`, `ingest-search.db.test.ts` › search                                         |
| FR-021     | Time bounds                                      | `ingest-search.db.test.ts` › honours earliest/latest                                                              |
| FR-022–023 | stats, span                                      | `ingest-search.db.test.ts` › grouped statistics, time-bucketed series                                             |
| FR-024     | sort/head/fields/where                           | `compiler.test.ts`, `ingest-search.db.test.ts` › projects fields                                                  |
| FR-025     | Histogram                                        | `histogram.test.ts`, `ingest-search.db.test.ts` › dense series                                                    |
| FR-026     | Validate with spans                              | `ingest-search.db.test.ts` › validates without executing, 422 span                                                |
| FR-027–030 | Search UI and keys screen                        | `Histogram.test.tsx`, `ResultsTable.test.tsx`, `QueryError.test.tsx`, `client.test.ts`, `e2e/tests/smoke.spec.ts` |
| FR-031–072 | Pending features                                 | `pending.http.test.ts` (501 contract); real tests arrive with each ticket                                         |
| NFR-004    | Query safety                                     | `injection.test.ts`, security block of `ingest-search.db.test.ts`                                                 |
| NFR-005    | Bounded queries                                  | `compiler.test.ts` limits, statement-timeout test                                                                 |
| NFR-006    | Tenant isolation                                 | `ingest-search.db.test.ts` › isolates tenants                                                                     |
| NFR-010    | Brute-force resistance                           | `limiter.test.ts`, `auth.db.test.ts` › login throttling                                                           |
| NFR-020    | Fail-fast config                                 | `env.test.ts`                                                                                                     |

## 7. Running the suites

```bash
./run.sh test                 # lint, format check, typecheck, all unit + integration tests
npm test -w @loglens/shared   # one package
npm run test:coverage         # with thresholds
```

### End-to-end smoke (local only)

```bash
./run.sh setup && ./run.sh dev          # terminal 1: API 4109, web 5109, seeded demo data
npx playwright install chromium         # once
E2E_ENABLED=1 npm run test:e2e          # terminal 2
```

The specs in `e2e/tests/smoke.spec.ts` sign in as the demo owner, run a stats query, check the histogram, and check the error underline. They skip themselves when `E2E_ENABLED` is unset, which is why they are not part of CI yet.

## 8. Planned additions

| Ticket          | Addition                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| LG-102 / LG-221 | Ingestion throughput benchmark and load tests verifying NFR-001..003                                      |
| LG-167          | Simulated-clock suite for alert evaluation: thresholds, EWMA, hysteresis, dedup across scheduler restarts |
| LG-121          | Property-based tests for the grok-style pattern engine (round trips, catastrophic-pattern rejection)      |
| LG-140          | WebSocket live-tail tests with LISTEN/NOTIFY under concurrent publishers                                  |
| LG-216          | Multi-instance limiter tests against shared Postgres counters                                             |
| LG-223          | Playwright in CI with cached browsers                                                                     |
| LG-224          | Automated accessibility checks on Search and Keys screens                                                 |
