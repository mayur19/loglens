# LogLens

[![CI](https://github.com/mayur19/loglens/actions/workflows/ci.yml/badge.svg)](https://github.com/mayur19/loglens/actions/workflows/ci.yml)

**Ship your logs to one self-hosted place, ask questions in a real query language, and get told
when something breaks, with no third-party services.**

LogLens is a self-hosted log platform for small and medium engineering teams that want
centralised logs without a hosted vendor. Services send JSON lines over HTTP with a per-tenant API
key. Events land in time-partitioned PostgreSQL tables. Engineers search them with **LensQL**, an
in-house query language with filters, boolean logic, regex, time ranges and pipelines such as
`| stats count() by service span=1m | sort -count | head 10`. LensQL is compiled to one safe,
parameterised SQL statement. Planned work adds dashboards, live tail, extraction pipelines and
alerting (thresholds and EWMA anomaly detection with flapping suppression).

> **Project status: early build.** The foundation, authentication (sessions, CSRF, RBAC, hardened
> login throttling), the full LensQL front end and compiler, API-key ingestion into partitioned
> tables, and the search screen with histogram and stats table are implemented and tested (401
> tests). Everything else is designed, documented and tracked in the
> [backlog](docs/planning/backlog.md): **10.9 %** of the estimated effort (149 of 1,371 hours) is
> complete, as computed in [implementation status](docs/planning/implementation-status.md). Pending
> API endpoints answer `501 Not Implemented` with their ticket id, and pending screens show a
> Planned badge naming the ticket.

## Project status

| Area                                                                                     | Status         | Tickets                              |
| ---------------------------------------------------------------------------------------- | -------------- | ------------------------------------ |
| E1 Platform: monorepo, config, migrations, health, `run.sh`, CI, seed, 501 registry      | ✅ Implemented | LG-001 to LG-008, LG-033, LG-034     |
| E2 Identity: register, login, sessions, CSRF, RBAC, login throttling, audit write path   | ✅ Implemented | LG-010 to LG-015                     |
| E3 LensQL engine: lexer, parser, analyzer, SQL compiler, histogram, injection test suite | ✅ Implemented | LG-020 to LG-025, LG-029             |
| E4 Ingestion: API keys, partitioned `log_events`, NDJSON/JSON ingest endpoint            | ✅ Implemented | LG-026 to LG-028                     |
| E6 Search screen, ingestion keys screen, web shell                                       | ✅ Implemented | LG-030 to LG-032                     |
| E4 Ingestion at scale: backpressure, COPY writer, gzip, idempotency, syslog, quotas      | ⏳ Pending     | LG-100 to LG-114                     |
| E5 Extraction pipelines (grok-style patterns, processors, editor)                        | ⏳ Pending     | LG-120 to LG-125                     |
| E3 LensQL extensions: `rex`, `eval`, `timechart`/`top`, cost guard, result cache         | ⏳ Pending     | LG-131 to LG-133, LG-137, LG-138     |
| E6 Search experience: saved searches, live tail, export, field catalog, autocomplete     | ⏳ Pending     | LG-130, LG-134 to LG-136, LG-139-142 |
| E7 Dashboards with SVG time-series panels                                                | ⏳ Pending     | LG-150 to LG-154                     |
| E8 Alerting: rules, leased scheduler, state machine, EWMA, flapping suppression          | ⏳ Pending     | LG-160 to LG-167                     |
| E9 Notifications (local outbox) and incidents with timelines                             | ⏳ Pending     | LG-170 to LG-182                     |
| E10 Retention policies, partition manager, archives, storage usage                       | ⏳ Pending     | LG-190 to LG-193                     |
| E2 Governance: members, invitations, password reset, email verification, MFA, RLS        | ⏳ Pending     | LG-200 to LG-217                     |
| E11 Operations: metrics, load tests, backup drills, Playwright in CI, deploy scripts     | ⏳ Pending     | LG-220 to LG-225                     |

## Quick start

Requirements: Node.js 22+, npm, and a natively installed PostgreSQL 15+ server (17 recommended)
that accepts socket connections in `/tmp` from your OS user without a password.

```bash
./run.sh
```

This checks prerequisites, creates `.env` from `.env.example` with a random `SESSION_SECRET`,
installs dependencies, creates the `loglens_dev` and `loglens_test` databases, applies migrations,
seeds demo data and starts:

- Web: http://localhost:5109
- API: http://127.0.0.1:4109 (proxied by the web dev server under `/api`)

Send your own events with an ingestion key (create one on the **Ingestion keys** screen, or use
the seeded demo key):

```bash
curl -X POST http://127.0.0.1:4109/api/v1/ingest \
  -H "Authorization: Bearer llk_DemoKey1_$(printf 'd%.0s' $(seq 1 43))" \
  -H 'Content-Type: application/x-ndjson' \
  --data-binary $'{"level":"error","service":"checkout","message":"payment declined","http":{"status":502}}'
```

Then try these LensQL queries on the Search screen:

```text
level=error service=checkout
"timeout" OR "connection reset" | stats count() by service
http.status>=500 NOT host=web-* | fields service, host, http.path
| stats count() by level span=5m
service=api-gateway | stats avg(latency_ms) as avg_ms, p95(latency_ms) by http.path | sort -avg_ms | head 5
```

## Demo logins (development only)

These accounts are created by the development seed (`apps/api/src/db/seed.ts`), are public, and
must never exist in a production database (the seed refuses to run with `NODE_ENV=production`).
Password for both: `loglens-demo-password`.

| Email              | Role   | Organization       |
| ------------------ | ------ | ------------------ |
| `owner@acme.test`  | Owner  | Acme Observability |
| `viewer@acme.test` | Viewer | Acme Observability |

The seed also creates the ingestion key `Demo shipper` (`llk_DemoKey1_` followed by 43 `d`
characters) and 20,000 deterministic events spread over the last 24 hours across five services
(checkout, api-gateway, billing, auth, worker), with an error spike on checkout and billing about
40 minutes before seeding so the histogram and stats have something to show. To check tenant
isolation, register a second workspace from the login screen.

## run.sh commands

| Command            | Description                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- |
| `./run.sh`         | Run `setup` if `.env` or `node_modules` is missing, then start API + web               |
| `./run.sh setup`   | Check prerequisites, create `.env`, install deps, create both databases, migrate, seed |
| `./run.sh migrate` | Apply pending SQL migrations to the dev database                                       |
| `./run.sh seed`    | Load demo data (idempotent)                                                            |
| `./run.sh reset`   | Drop and recreate the dev schema, then migrate and seed (refused in production)        |
| `./run.sh test`    | Lint, format check, typecheck and all test suites against `loglens_test`               |
| `./run.sh dev`     | Start the API (port 4109) and web dev server (port 5109)                               |
| `./run.sh help`    | Show all commands                                                                      |

## Tech stack

| Layer    | Technology                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| API      | Node.js 22, Fastify 5, `@fastify/cookie`, TypeScript (strict), zod, node-postgres, pino                         |
| Web      | React 18, React Router 6, Vite 6, plain CSS with design tokens, dependency-free SVG charts                      |
| Database | PostgreSQL 15+ (declarative range partitioning, `pg_trgm`, jsonb GIN), plain-SQL migrations                     |
| Shared   | `@loglens/shared`: LensQL lexer/parser/analyzer/compiler, ingestion normalisation, roles, zod schemas, envelope |
| Tests    | Vitest, Testing Library, Fastify `inject` against a real PostgreSQL test database, Playwright                   |
| Tooling  | npm workspaces, ESLint 9, Prettier, tsup, GitHub Actions (runner's preinstalled PostgreSQL)                     |

## Repository layout

```
loglens/
├── apps/
│   ├── api/                          Fastify API
│   │   ├── migrations/               0001_foundation.sql, 0002_ingestion_and_search.sql
│   │   ├── src/
│   │   │   ├── config/               zod-validated env (TRUST_PROXY rules)
│   │   │   ├── db/                   pool, migration runner, partitions, seed, CLI
│   │   │   ├── http/                 error envelope, CSRF, auth guard, cookies
│   │   │   └── modules/
│   │   │       ├── auth/             sessions, scrypt, login/registration throttles   implemented
│   │   │       ├── api-keys/         hashed ingestion keys                            implemented
│   │   │       ├── ingest/           NDJSON/JSON ingestion into partitions            implemented
│   │   │       ├── search/           search, histogram, validate (read-only txns)     implemented
│   │   │       ├── audit/ health/                                                     implemented
│   │   │       └── pending/          45 planned endpoints answering 501 + ticket
│   │   └── test/                     unit, HTTP and PostgreSQL integration tests
│   └── web/                          React SPA (search + ingestion keys; PendingPage for planned sections)
├── packages/shared/
│   └── src/lensql/                   LensQL lexer, parser, analyzer, compiler, histogram   implemented
├── e2e/                              Playwright config and smoke specs
├── docs/                             product, architecture, ADRs, design, API, security, testing, ops, planning
├── run.sh                            single entry point
└── .env.example                      placeholder configuration
```

## Documentation

Start with the [documentation index](docs/README.md). Key documents:
[PRD](docs/product/PRD.md) ·
[requirements](docs/product/requirements.md) ·
[architecture](docs/architecture/overview.md) ·
[ADRs](docs/adr/README.md) ·
[data model](docs/design/data-model.md) ·
[system design](docs/design/system-design.md) ·
[API](docs/api/README.md) ([OpenAPI](docs/api/openapi.yaml)) ·
[threat model](docs/security/threat-model.md) ·
[test strategy](docs/testing/test-strategy.md) ·
[runbook](docs/operations/runbook.md) ·
[deployment](docs/operations/deployment.md) ·
[roadmap](docs/planning/roadmap.md) ·
[backlog](docs/planning/backlog.md) ·
[implementation status](docs/planning/implementation-status.md)

## Known limitations

- Login and registration throttle counters live in process memory, so run a single API instance
  until they move to PostgreSQL (LG-216).
- Only HTTP NDJSON/JSON ingestion exists; syslog, gzip bodies, quotas and backpressure are pending
  (LG-100 to LG-114).
- Search, the histogram and the stats table work end to end; dashboards, live tail, saved searches
  and alerting are pending (see status table).
- Partitions are created at startup and once per UTC day on ingest; retention by dropping
  partitions and draining the default partition need the partition manager (LG-190, LG-191).
- Registration does not verify email addresses yet (LG-211, via a local outbox), and there is no
  password reset (LG-210).
- Playwright smoke specs are not run in CI (no browser binaries); run them locally with
  `E2E_ENABLED=1 npm run test:e2e`.
- No external integrations by design: notifications will go to a local outbox table, not to email
  or chat providers.

## Contributing, security and license

- [Contributing guide](CONTRIBUTING.md): workflow, commit conventions, engineering rules.
- [Security policy](SECURITY.md): how to report vulnerabilities and hardening notes.
- [Changelog](CHANGELOG.md).
- Licensed under the [MIT License](LICENSE).
