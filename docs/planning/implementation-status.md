# Implementation Status

**LogLens 0.1.0 is 10.9 % implemented**: 149 of 1 371 estimated engineering hours are done. 1 222 hours across 74 tickets are pending.

## How the percentage is computed

```
implemented % = Σ hours of tickets with status "done" / Σ hours of all tickets
              = 149 / 1371 = 10.9 %
```

The ticket table, estimates and statuses are in [backlog.md](backlog.md), with a machine-readable copy in [backlog.json](backlog.json). A ticket counts as done only when its code, tests and docs are merged and CI is green. Partial work counts as zero.

## Done

| Area                   | What exists                                                                                                                                                                                                                                                                                            | Key files                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Platform (M0)          | npm workspaces, strict TypeScript, ESLint/Prettier, zod config with fail-fast and `TRUST_PROXY` rules, Fastify app with JSON envelope, central error handler, request IDs, redacted logs, migration runner with checksums and advisory lock, `/health` and `/ready`, `run.sh`, CI on native PostgreSQL | `apps/api/src/app.ts`, `config/env.ts`, `db/migrate.ts`, `run.sh`, `.github/workflows/ci.yml`                                     |
| Identity & access (M1) | Non-enumerating registration (IP-limited), login/logout/me with hashed sessions, CSRF double submit, three-counter login throttle with bounded store and IP normalisation, RBAC permissions, append-only audit trail                                                                                   | `apps/api/src/modules/auth/*`, `http/csrf.ts`, `http/auth-guard.ts`, `packages/shared/src/roles.ts`                               |
| LensQL engine (M2)     | Lexer, recursive-descent parser with spans, semantic analyzer, compiler to one parameterised statement (events and stats modes, post-stats where/sort/head, projections, percentiles, `date_bin` buckets), histogram compilation and dense fill                                                        | `packages/shared/src/lensql/*`                                                                                                    |
| Ingestion (M2)         | API keys (hashed, prefix lookup, constant-time compare, revoke), daily range-partitioned `log_events` with default partition and partition function, NDJSON/JSON ingestion with normalisation and per-line rejection                                                                                   | `apps/api/src/modules/api-keys/*`, `modules/ingest/*`, `migrations/0002_ingestion_and_search.sql`, `packages/shared/src/ingest/*` |
| Search API (M2)        | `/search`, `/search/histogram`, `/search/validate` in read-only transactions with statement timeout and error mapping                                                                                                                                                                                  | `apps/api/src/modules/search/*`                                                                                                   |
| Web (M2)               | Login/register, app shell with Planned badges, Search screen (query bar, presets, examples, SVG histogram, results table, error underline), Ingestion keys screen                                                                                                                                      | `apps/web/src/*`                                                                                                                  |
| Seed (M2)              | 20 000 deterministic demo events over 24 h with an incident spike, owner and viewer users, demo key                                                                                                                                                                                                    | `apps/api/src/db/seed.ts`, `seed-data.ts`                                                                                         |

## Stubbed (registered, return `501 NOT_IMPLEMENTED` with a ticket)

| Endpoint(s)                                                                          | Ticket |
| ------------------------------------------------------------------------------------ | ------ |
| `POST /api/v1/auth/verify-email`                                                     | LG-211 |
| `POST /api/v1/auth/password-reset`                                                   | LG-210 |
| `GET, PATCH /api/v1/organization`                                                    | LG-215 |
| `GET /api/v1/members`                                                                | LG-200 |
| `POST /api/v1/invitations`                                                           | LG-201 |
| `PATCH /api/v1/members/{userId}`                                                     | LG-202 |
| `GET /api/v1/audit-events`                                                           | LG-205 |
| `POST /api/v1/ingest/syslog`                                                         | LG-110 |
| `GET /api/v1/ingest/quota`                                                           | LG-112 |
| `GET, POST /api/v1/pipelines`                                                        | LG-120 |
| `POST /api/v1/pipelines/test`                                                        | LG-122 |
| `GET /api/v1/fields`                                                                 | LG-135 |
| `POST /api/v1/search/export`                                                         | LG-136 |
| `GET, POST /api/v1/saved-searches`; `GET, PATCH, DELETE /api/v1/saved-searches/{id}` | LG-130 |
| `GET /api/v1/tail` (WebSocket)                                                       | LG-140 |
| `GET, POST /api/v1/dashboards`; `GET, PATCH, DELETE /api/v1/dashboards/{id}`         | LG-150 |
| `POST /api/v1/dashboards/{id}/panels`                                                | LG-151 |
| `GET, POST /api/v1/alert-rules`; `GET, PATCH, DELETE /api/v1/alert-rules/{id}`       | LG-160 |
| `POST /api/v1/alert-rules/{id}/preview`                                              | LG-162 |
| `GET /api/v1/alerts`                                                                 | LG-163 |
| `POST /api/v1/alerts/{id}/acknowledge`                                               | LG-164 |
| `GET, POST /api/v1/notification-channels`                                            | LG-170 |
| `GET /api/v1/notifications`                                                          | LG-172 |
| `GET /api/v1/outbox`                                                                 | LG-171 |
| `GET, POST /api/v1/incidents`                                                        | LG-180 |
| `GET /api/v1/incidents/{id}/timeline`                                                | LG-181 |
| `GET, PUT /api/v1/retention`                                                         | LG-190 |
| `GET /api/v1/partitions`                                                             | LG-191 |

The authoritative list is `PENDING_ROUTES` in `apps/api/src/modules/pending/pending.routes.ts`. `apps/api/test/pending.http.test.ts` checks each one. In the web app, Live tail, Saved searches, Dashboards, Alerts, Incidents, Pipelines and Settings appear in the navigation with a **Planned** badge.

## Progress by epic

| Epic                         |  Done h |   Total h |        % |
| ---------------------------- | ------: | --------: | -------: |
| E1 Platform                  |      37 |        37 |    100.0 |
| E2 Identity & access         |      29 |       203 |     14.3 |
| E3 LensQL engine             |      49 |       157 |     31.2 |
| E4 Ingestion                 |      18 |       176 |     10.2 |
| E5 Pipelines                 |       0 |       114 |      0.0 |
| E6 Search experience         |      16 |       164 |      9.8 |
| E7 Dashboards                |       0 |        98 |      0.0 |
| E8 Alerting                  |       0 |       164 |      0.0 |
| E9 Incidents & notifications |       0 |       118 |      0.0 |
| E10 Storage & retention      |       0 |        62 |      0.0 |
| E11 Operations               |       0 |        78 |      0.0 |
| **Total**                    | **149** | **1 371** | **10.9** |

## Progress by milestone

| Milestone                              | Done h | Total h |   % |
| -------------------------------------- | -----: | ------: | --: |
| M0 Foundation                          |     32 |      32 | 100 |
| M1 Identity & access                   |     29 |      29 | 100 |
| M2 LensQL search slice                 |     88 |      88 | 100 |
| M3 Ingestion at scale                  |      0 |     158 |   0 |
| M4 Pipelines                           |      0 |     114 |   0 |
| M5 Search experience & live tail       |      0 |     240 |   0 |
| M6 Dashboards                          |      0 |     114 |   0 |
| M7 Alerting, notifications & incidents |      0 |     282 |   0 |
| M8 Governance & operations             |      0 |     314 |   0 |

## Schema coverage

Migrated: `organizations`, `users`, `memberships`, `sessions`, `audit_events`, `api_keys`, `log_events` (partitioned) plus `log_events_default` and the daily partitions. The other planned tables (alert rules, dashboards, outbox, retention policies and so on) are designed in [data-model.md](../design/data-model.md) but not migrated.

## Test status

| Package           |   Tests |                Statement coverage |
| ----------------- | ------: | --------------------------------: |
| `packages/shared` |     228 |                            99.7 % |
| `apps/api`        |     159 |                            98.1 % |
| `apps/web`        |      14 |                          reported |
| **Total**         | **401** | thresholds: 90 % shared, 80 % api |

Two Playwright smoke specs exist in `e2e/` and run locally with `E2E_ENABLED=1` (see [test-strategy.md](../testing/test-strategy.md)).
