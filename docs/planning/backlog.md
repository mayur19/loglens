# Backlog

Every ticket in LogLens. Estimates are engineering hours (design, implementation, tests, docs). Status is `done` or `pending`. The implementation percentage in [implementation-status.md](implementation-status.md) is computed from this table: **done hours / total hours**.

**Totals:** 103 tickets · 1371 h · done 149 h · pending 1222 h · **10.9% implemented**.

Epics: E1 Platform · E2 Identity & access · E3 LensQL engine · E4 Ingestion · E5 Pipelines · E6 Search experience · E7 Dashboards · E8 Alerting · E9 Incidents & notifications · E10 Storage & retention · E11 Operations.

Milestones are described in [roadmap.md](roadmap.md).

## M0 (32 h)

| ID     | Title                                                                        | Epic        | Est. (h) | Status | Depends on |
| ------ | ---------------------------------------------------------------------------- | ----------- | -------: | ------ | ---------- |
| LG-001 | Monorepo tooling: npm workspaces, strict TS, ESLint, Prettier                | E1 Platform |        6 | done   | —          |
| LG-002 | Zod-validated config loader incl. TRUST_PROXY rules                          | E1 Platform |        3 | done   | LG-001     |
| LG-003 | Fastify app shell: envelope, central errors, request IDs, redacted logs      | E1 Platform |        6 | done   | LG-001     |
| LG-004 | Forward-only migration runner (checksums, advisory lock, per-file txn)       | E1 Platform |        5 | done   | LG-003     |
| LG-005 | Foundation schema: organizations, users, memberships, sessions, audit_events | E1 Platform |        4 | done   | LG-004     |
| LG-006 | Health and readiness endpoints                                               | E1 Platform |        1 | done   | LG-003     |
| LG-007 | run.sh launcher (setup/migrate/seed/reset/test/dev)                          | E1 Platform |        4 | done   | LG-004     |
| LG-008 | CI on GitHub runner with native PostgreSQL (no containers)                   | E1 Platform |        3 | done   | LG-001     |

## M1 (29 h)

| ID     | Title                                                                       | Epic                 | Est. (h) | Status | Depends on |
| ------ | --------------------------------------------------------------------------- | -------------------- | -------: | ------ | ---------- |
| LG-010 | Register organization owner (non-enumerating, IP-limited)                   | E2 Identity & access |        6 | done   | LG-005     |
| LG-011 | Login / logout / me with hashed Postgres sessions                           | E2 Identity & access |        6 | done   | LG-005     |
| LG-012 | CSRF double-submit protection                                               | E2 Identity & access |        3 | done   | LG-011     |
| LG-013 | Login throttle: email backoff, IP spray limiter, fan-out cap, bounded store | E2 Identity & access |        8 | done   | LG-011     |
| LG-014 | RBAC skeleton: roles to permissions, route guards                           | E2 Identity & access |        3 | done   | LG-011     |
| LG-015 | Audit write path with append-only trigger                                   | E2 Identity & access |        3 | done   | LG-005     |

## M2 (88 h)

| ID     | Title                                                                        | Epic                 | Est. (h) | Status | Depends on    |
| ------ | ---------------------------------------------------------------------------- | -------------------- | -------: | ------ | ------------- |
| LG-020 | LensQL lexer with spans and limits                                           | E3 LensQL engine     |        5 | done   | LG-001        |
| LG-021 | LensQL recursive-descent parser and AST                                      | E3 LensQL engine     |       10 | done   | LG-020        |
| LG-022 | Semantic analyzer: pipeline stage ordering and validation                    | E3 LensQL engine     |        5 | done   | LG-021        |
| LG-023 | Compiler to parameterized SQL (filters, stats, where, sort, head, fields)    | E3 LensQL engine     |       14 | done   | LG-022        |
| LG-024 | Histogram compilation and dense bucket fill                                  | E3 LensQL engine     |        3 | done   | LG-023        |
| LG-025 | Injection and adversarial test suite for the compiler                        | E3 LensQL engine     |        6 | done   | LG-023        |
| LG-026 | Ingestion API keys: create/list/revoke, SHA-256 at rest, constant-time check | E4 Ingestion         |        5 | done   | LG-014        |
| LG-027 | Time-partitioned log_events with daily partition function                    | E4 Ingestion         |        5 | done   | LG-004        |
| LG-028 | NDJSON/JSON ingestion endpoint with event normalisation                      | E4 Ingestion         |        8 | done   | LG-026,LG-027 |
| LG-029 | Search, histogram and validate API (read-only txn, statement timeout)        | E3 LensQL engine     |        6 | done   | LG-023,LG-027 |
| LG-030 | Web shell: login/register, layout, Planned badges                            | E6 Search experience |        5 | done   | LG-011        |
| LG-031 | Search screen: query bar, SVG histogram, results table, error underline      | E6 Search experience |        8 | done   | LG-029,LG-030 |
| LG-032 | Ingestion keys screen                                                        | E6 Search experience |        3 | done   | LG-026,LG-030 |
| LG-033 | Deterministic demo seed (24h, incident spike)                                | E1 Platform          |        3 | done   | LG-028        |
| LG-034 | Pending endpoint registry answering 501 with ticket ids                      | E1 Platform          |        2 | done   | LG-003        |

## M3 (158 h)

| ID     | Title                                                          | Epic         | Est. (h) | Status  | Depends on |
| ------ | -------------------------------------------------------------- | ------------ | -------: | ------- | ---------- |
| LG-100 | Ingestion batching queue with backpressure (429 + Retry-After) | E4 Ingestion |       24 | pending | LG-028     |
| LG-101 | COPY-based bulk writer for high-volume batches                 | E4 Ingestion |       20 | pending | LG-100     |
| LG-102 | Ingestion throughput benchmark harness                         | E4 Ingestion |       12 | pending | LG-101     |
| LG-103 | gzip/deflate request bodies with decompression-bomb limits     | E4 Ingestion |        8 | pending | LG-028     |
| LG-104 | Idempotent batch submission via Idempotency-Key                | E4 Ingestion |       10 | pending | LG-028     |
| LG-105 | Dead-letter store for rejected events                          | E4 Ingestion |       10 | pending | LG-028     |
| LG-110 | RFC 5424 syslog parser and ingestion endpoint                  | E4 Ingestion |       20 | pending | LG-028     |
| LG-111 | RFC 3164 (BSD) syslog fallback parser                          | E4 Ingestion |       10 | pending | LG-110     |
| LG-112 | Per-tenant ingestion quotas with usage metering                | E4 Ingestion |       22 | pending | LG-028     |
| LG-113 | Per-key token-bucket rate limiting in Postgres                 | E4 Ingestion |       14 | pending | LG-026     |
| LG-114 | API key scopes and expiry                                      | E4 Ingestion |        8 | pending | LG-026     |

## M4 (114 h)

| ID     | Title                                                        | Epic         | Est. (h) | Status  | Depends on    |
| ------ | ------------------------------------------------------------ | ------------ | -------: | ------- | ------------- |
| LG-120 | Extraction pipeline model and CRUD                           | E5 Pipelines |       16 | pending | LG-028        |
| LG-121 | Grok-style pattern engine with in-house pattern library      | E5 Pipelines |       36 | pending | LG-120        |
| LG-122 | Pipeline dry-run endpoint against sample lines               | E5 Pipelines |        8 | pending | LG-121        |
| LG-123 | Pipeline execution in the ingest path with per-event budgets | E5 Pipelines |       18 | pending | LG-121,LG-100 |
| LG-124 | Type coercion, rename and drop processors                    | E5 Pipelines |       12 | pending | LG-121        |
| LG-125 | Pipeline editor UI with live preview                         | E5 Pipelines |       24 | pending | LG-122        |

## M5 (240 h)

| ID     | Title                                                                 | Epic                 | Est. (h) | Status  | Depends on |
| ------ | --------------------------------------------------------------------- | -------------------- | -------: | ------- | ---------- |
| LG-130 | Saved searches CRUD and sharing                                       | E6 Search experience |       16 | pending | LG-029     |
| LG-131 | LensQL rex command (query-time regex extraction)                      | E3 LensQL engine     |       24 | pending | LG-023     |
| LG-132 | LensQL eval expressions (arithmetic, string and time functions)       | E3 LensQL engine     |       32 | pending | LG-023     |
| LG-133 | LensQL timechart, top and rare commands                               | E3 LensQL engine     |       16 | pending | LG-023     |
| LG-134 | Query editor autocomplete and syntax highlighting                     | E6 Search experience |       28 | pending | LG-135     |
| LG-135 | Field catalog with sampled types and cardinality                      | E6 Search experience |       20 | pending | LG-029     |
| LG-136 | Streaming export of results (NDJSON/CSV)                              | E6 Search experience |       12 | pending | LG-029     |
| LG-137 | Query cost guard using EXPLAIN estimates                              | E3 LensQL engine     |       20 | pending | LG-029     |
| LG-139 | Keyset pagination for event results                                   | E6 Search experience |       10 | pending | LG-029     |
| LG-140 | Live tail WebSocket server (LISTEN/NOTIFY fan-out, filter evaluation) | E6 Search experience |       36 | pending | LG-029     |
| LG-141 | Live tail UI with pause and highlighting                              | E6 Search experience |       16 | pending | LG-140     |
| LG-142 | Event context view (surrounding lines)                                | E6 Search experience |       10 | pending | LG-029     |

## M6 (114 h)

| ID     | Title                                                        | Epic             | Est. (h) | Status  | Depends on |
| ------ | ------------------------------------------------------------ | ---------------- | -------: | ------- | ---------- |
| LG-138 | Result cache for repeated dashboard queries                  | E3 LensQL engine |       16 | pending | LG-151     |
| LG-150 | Dashboard CRUD and grid layout                               | E7 Dashboards    |       20 | pending | LG-130     |
| LG-151 | Time-series panels backed by stats span queries              | E7 Dashboards    |       18 | pending | LG-150     |
| LG-152 | In-house SVG chart library (line, area, bar, axes, tooltips) | E7 Dashboards    |       32 | pending | LG-031     |
| LG-153 | Dashboard variables and shared time picker                   | E7 Dashboards    |       16 | pending | LG-151     |
| LG-154 | Panel auto-refresh with request coalescing                   | E7 Dashboards    |       12 | pending | LG-151     |

## M7 (282 h)

| ID     | Title                                                             | Epic                         | Est. (h) | Status  | Depends on |
| ------ | ----------------------------------------------------------------- | ---------------------------- | -------: | ------- | ---------- |
| LG-160 | Alert rule model and CRUD (query, schedule, threshold)            | E8 Alerting                  |       20 | pending | LG-029     |
| LG-161 | Leased evaluation scheduler (FOR UPDATE SKIP LOCKED)              | E8 Alerting                  |       28 | pending | LG-160     |
| LG-162 | Rule preview and backtest over history                            | E8 Alerting                  |       18 | pending | LG-160     |
| LG-163 | Alert state machine with dedup keys                               | E8 Alerting                  |       24 | pending | LG-161     |
| LG-164 | Acknowledge and silence alerts                                    | E8 Alerting                  |       10 | pending | LG-163     |
| LG-165 | EWMA anomaly detection rules                                      | E8 Alerting                  |       28 | pending | LG-163     |
| LG-166 | Flapping suppression with hysteresis                              | E8 Alerting                  |       16 | pending | LG-163     |
| LG-167 | Simulated-clock correctness suite for alert evaluation            | E8 Alerting                  |       20 | pending | LG-163     |
| LG-170 | Notification channels: in-app, webhook-to-outbox, email-to-outbox | E9 Incidents & notifications |       16 | pending | LG-163     |
| LG-171 | Local outbox with delivery worker, retries and backoff            | E9 Incidents & notifications |       22 | pending | LG-170     |
| LG-172 | In-app notification inbox                                         | E9 Incidents & notifications |       12 | pending | LG-170     |
| LG-173 | Notification templates                                            | E9 Incidents & notifications |       10 | pending | LG-170     |
| LG-180 | Incidents: open from alerts, assign, status workflow              | E9 Incidents & notifications |       20 | pending | LG-163     |
| LG-181 | Incident timeline (transitions, notes, linked searches)           | E9 Incidents & notifications |       18 | pending | LG-180     |
| LG-182 | Incident screens                                                  | E9 Incidents & notifications |       20 | pending | LG-181     |

## M8 (314 h)

| ID     | Title                                                              | Epic                    | Est. (h) | Status  | Depends on |
| ------ | ------------------------------------------------------------------ | ----------------------- | -------: | ------- | ---------- |
| LG-190 | Per-tenant retention policies                                      | E10 Storage & retention |       14 | pending | LG-027     |
| LG-191 | Partition manager job: pre-create, drop expired, drain default     | E10 Storage & retention |       22 | pending | LG-190     |
| LG-192 | Archive partitions to local disk before drop                       | E10 Storage & retention |       16 | pending | LG-191     |
| LG-193 | Per-tenant storage usage reporting                                 | E10 Storage & retention |       10 | pending | LG-191     |
| LG-200 | Members list                                                       | E2 Identity & access    |        8 | pending | LG-014     |
| LG-201 | Invitations via the local outbox                                   | E2 Identity & access    |       14 | pending | LG-171     |
| LG-202 | Role changes with last-owner protection                            | E2 Identity & access    |        8 | pending | LG-200     |
| LG-203 | Custom roles and fine-grained permissions                          | E2 Identity & access    |       24 | pending | LG-202     |
| LG-204 | PostgreSQL row-level security as defence in depth                  | E2 Identity & access    |       20 | pending | LG-014     |
| LG-205 | Audit trail browser and export                                     | E2 Identity & access    |       12 | pending | LG-015     |
| LG-210 | Password reset via the local outbox                                | E2 Identity & access    |       10 | pending | LG-171     |
| LG-211 | Email verification for self-service signup via the local outbox    | E2 Identity & access    |       12 | pending | LG-171     |
| LG-212 | TOTP multi-factor authentication (RFC 6238, in-house)              | E2 Identity & access    |       20 | pending | LG-011     |
| LG-213 | Session management (list and revoke sessions)                      | E2 Identity & access    |        8 | pending | LG-011     |
| LG-214 | Organization switcher for multi-org users                          | E2 Identity & access    |       10 | pending | LG-200     |
| LG-215 | Organization settings                                              | E2 Identity & access    |        8 | pending | LG-014     |
| LG-216 | Move limiter counters to PostgreSQL for multi-instance deployments | E2 Identity & access    |       14 | pending | LG-013     |
| LG-217 | Content-Security-Policy and SPA hardening                          | E2 Identity & access    |        6 | pending | LG-030     |
| LG-220 | Self-observability metrics endpoint (Prometheus text format)       | E11 Operations          |       12 | pending | LG-003     |
| LG-221 | Load-test suite and capacity report                                | E11 Operations          |       20 | pending | LG-102     |
| LG-222 | Backup and restore drill automation                                | E11 Operations          |       10 | pending | LG-007     |
| LG-223 | Playwright end-to-end suite in CI with cached browsers             | E11 Operations          |       12 | pending | LG-031     |
| LG-224 | Accessibility audit and fixes                                      | E11 Operations          |       14 | pending | LG-031     |
| LG-225 | systemd and nginx deployment scripts                               | E11 Operations          |       10 | pending | LG-007     |
