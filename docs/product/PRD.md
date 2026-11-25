# LogLens — Product Requirements Document

| Field   | Value                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Product | LogLens — self-hosted log ingestion, LensQL query language and alerting                                                                         |
| Status  | M0–M2 delivered (foundation + search slice); M3–M8 planned                                                                                      |
| Owner   | LogLens contributors                                                                                                                                    |
| Related | [requirements.md](requirements.md) · [user-stories.md](user-stories.md) · [roadmap](../planning/roadmap.md) · [backlog](../planning/backlog.md) |

## 1. Vision

Give small and medium engineering teams a log platform they can run on one Linux VM next to the
PostgreSQL they already operate: ship JSON or syslog lines over HTTP, ask questions in a compact
pipeline language (LensQL), see the answer as a histogram and a table in under two seconds, and get
told — without any third-party service — when error rates break a threshold or drift from normal.

## 2. Problem

- Hosted log services price by ingested gigabyte; teams with 5–50 GB/day either sample aggressively
  or turn logging off in exactly the services that later fail.
- Self-hosted alternatives typically require a search cluster (several JVM nodes, shard tuning,
  separate storage tiers) that a team without a dedicated platform engineer cannot operate safely.
- Ad-hoc `grep` across hosts gives no aggregation ("which service started returning 5xx at 14:05?"),
  no history after rotation, and no alerting.
- Teams that already run PostgreSQL have operational knowledge (backups, `pg_dump`, upgrades,
  monitoring) that a log platform could reuse instead of introducing a new datastore.

## 3. Personas

| Persona                         | Context                                                         | Primary jobs                                                                                          |
| ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Priya — on-call SRE**         | Paged at 03:00; needs the failing service and first error fast. | Filter by level/service, histogram to find the spike, `stats count() by host`, live tail, ack alerts. |
| **Ben — backend developer**     | Ships a service; wants structured logs to be queryable.         | Create an ingestion key, send NDJSON, query attributes (`http.status>=500`), save searches.           |
| **Elena — engineering manager** | Owns reliability goals for three teams.                         | Dashboards of error rate and p95 latency per service, incident timeline for post-mortems.             |
| **Sam — security / compliance** | Answers "who did what, when" and enforces retention.            | Audit trail, RBAC, retention policies per tenant, guarantees that queries cannot leak across tenants. |
| **Olu — platform operator**     | Installs and upgrades LogLens on a VM.                          | `run.sh setup`, migrations, partition health, backups with `pg_dump`, capacity planning.              |

## 4. Goals and non-goals

### Goals

1. **G1 – Safe, expressive querying.** LensQL covers filtering, boolean logic, regex, time ranges and
   aggregation pipelines, and compiles to a single parameterised SQL statement that cannot escape
   its tenant or run unbounded (see ADR-0011 in [docs/adr](../adr/README.md)).
2. **G2 – Cheap ingestion on commodity hardware.** At least 5,000 events/s per API instance into
   daily PostgreSQL partitions (NFR-002), with per-line rejection instead of whole-batch failure.
3. **G3 – Correct alerting.** Threshold and EWMA anomaly rules evaluated on a schedule with
   deduplication and flapping suppression; notifications delivered through a local outbox.
4. **G4 – Operable by a generalist.** One bash launcher, one database, systemd + nginx deployment,
   forward-only migrations, retention by dropping partitions.
5. **G5 – Multi-tenant by construction.** Every statement is scoped by `organization_id`;
   RBAC on every endpoint; append-only audit trail.

### Non-goals

- Distributed tracing or metrics storage (trace IDs are stored and searchable, spans are not).
- Full-text relevance ranking; results are ordered by time or by aggregation output.
- Petabyte scale or multi-region replication; the target is ≤ 50 GB/day per installation.
- Any dependency on hosted services (email/SMS providers, OAuth, CDNs, cloud storage).
- Container-based packaging; LogLens is deployed as native processes.

## 5. Scope

### In scope (whole product)

| Area                    | Capabilities                                                                                                                                          | Status             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Identity & tenancy      | Organizations, users, roles, sessions, CSRF, throttled login, audit trail                                                                             | Implemented (core) |
| Ingestion               | API keys, NDJSON/JSON over HTTP, normalisation, daily partitions                                                                                      | Implemented        |
| Ingestion at scale      | Syslog RFC 5424/3164, quotas, backpressure, gzip, idempotency, dead-letter store                                                                      | Planned (M3)       |
| LensQL & search         | Filters, boolean logic, regex, IN, existence, earliest/latest, `stats`/`span`, `where`/`sort`/`head`/`fields`, histogram, validation with error spans | Implemented        |
| Pipelines               | Grok-style extraction, processors, dry-run, editor                                                                                                    | Planned (M4)       |
| Search experience       | Saved searches, live tail, export, field catalog, autocomplete, `rex`/`eval`/`timechart`                                                              | Planned (M5)       |
| Dashboards              | Time-series panels, in-house SVG charts, variables, auto-refresh                                                                                      | Planned (M6)       |
| Alerting & incidents    | Rules, leased scheduler, state machine, EWMA, hysteresis, outbox notifications, incidents                                                             | Planned (M7)       |
| Governance & operations | Members/invitations, MFA, retention, partition manager, metrics, deployment scripts                                                                   | Planned (M8)       |

### Out of scope

Hosted SaaS operation, billing, mobile apps, SSO via external identity providers, log forwarding
agents for hosts (users ship with existing tools such as `vector`, `fluent-bit` or `curl`).

## 6. Delivered slice (M0–M2)

The first slice proves the hardest part of the product end to end:

- **LensQL front end and compiler** in `packages/shared/src/lensql/` — lexer, recursive-descent
  parser with character spans, stage analyser, compiler to parameterised SQL, histogram compiler.
  228 unit tests including an injection suite (`packages/shared/test/lensql/injection.test.ts`).
- **Ingestion** — `POST /api/v1/ingest` authenticated by hashed API keys, writing batches with one
  `unnest` statement into `log_events`, a range-partitioned table with daily partitions.
- **Search API** — `POST /api/v1/search`, `/search/histogram`, `/search/validate`, executed in
  `READ ONLY` transactions with a local statement timeout.
- **UI** — login/register, app shell with Planned sections, search screen with SVG histogram,
  results table and an underline on the exact token that failed, ingestion-key management.
- **Security foundation** — scrypt passwords, hashed sessions, CSRF double submit, email/IP login
  throttles, non-enumerating registration, append-only audit trail.

## 7. Success metrics

| Metric                                                   | Target                     | Measured by                                   |
| -------------------------------------------------------- | -------------------------- | --------------------------------------------- |
| Time from `git clone` to first search result             | < 10 minutes               | `./run.sh setup && ./run.sh dev`, seeded data |
| Search latency, 1 h window, 10M events/tenant/day        | p95 < 1.5 s (NFR-001)      | LG-221 load test                              |
| Ingestion throughput per API instance                    | ≥ 5,000 events/s (NFR-002) | LG-102 benchmark harness                      |
| Queries that reach SQL with interpolated user text       | 0 (NFR-004)                | Compiler tests + injection suite              |
| Alert false-positive rate on flapping signals            | < 5% of notifications      | LG-167 simulated-clock suite                  |
| Mean time to identify failing service during an incident | < 5 minutes                | Usability sessions with on-call engineers     |
| Weekly active searchers / seats                          | ≥ 60%                      | Session and search audit counts               |

## 8. Release plan

| Milestone | Theme                               | Contents (tickets)    | Exit criterion                                                    | Status  |
| --------- | ----------------------------------- | --------------------- | ----------------------------------------------------------------- | ------- |
| M0        | Foundation                          | LG-001–LG-008         | CI green, migrations run, health endpoints answer                 | Done    |
| M1        | Identity & access                   | LG-010–LG-015         | Register/login/logout with throttling and audit                   | Done    |
| M2        | LensQL search slice                 | LG-020–LG-034         | Ingest NDJSON, search with stats and histogram in the UI          | Done    |
| M3        | Ingestion at scale                  | LG-100–LG-114         | 5k events/s benchmark, syslog accepted, quotas enforced           | Planned |
| M4        | Pipelines                           | LG-120–LG-125         | Grok pattern extracts fields at ingest with dry-run preview       | Planned |
| M5        | Search experience & live tail       | LG-130–LG-142         | Saved searches, live tail < 2 s latency, autocomplete             | Planned |
| M6        | Dashboards                          | LG-138, LG-150–LG-154 | Dashboards with refreshing SVG time-series panels                 | Planned |
| M7        | Alerting, notifications & incidents | LG-160–LG-182         | Threshold + EWMA alerts fire correctly under simulated clock      | Planned |
| M8        | Governance & operations             | LG-190–LG-225         | Retention by partition drop, invitations, MFA, systemd deployment | Planned |

## 9. Assumptions and constraints

- PostgreSQL 15+ is installed natively; `date_bin` (PG 14+) and declarative partitioning are used.
- One API instance until LG-216 moves limiter counters into PostgreSQL.
- Event timestamps are accepted up to 30 days in the past and 10 minutes in the future
  (`packages/shared/src/ingest/normalize.ts`); partitions exist for today −31 … +7 days.
- All notifications are written to a local outbox table and delivered by a local worker.

## 10. Open questions

1. Should retention be configurable per service in addition to per tenant (LG-190)?
2. Is a 90-day maximum query range sufficient for compliance searches, or do archived
   partitions (LG-192) need to be queryable in place?
3. Do anomaly rules need seasonality (hour-of-week baselines) beyond EWMA in the first release?
