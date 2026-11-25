# Architecture Decision Records

Decisions are recorded in [MADR](https://adr.github.io/madr/) format (Status, Context, Decision Drivers, Considered Options, Decision Outcome, Consequences). See [ADR-0001](0001-record-architecture-decisions.md) for the process. Accepted ADRs are immutable; changes of direction supersede them with a new record. Proposed ADRs describe the design for pending milestones and are promoted when their tickets land.

| ADR                                                  | Title                                                                       | Status   | Area              |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | -------- | ----------------- |
| [0001](0001-record-architecture-decisions.md)        | Record architecture decisions                                               | Accepted | Process           |
| [0002](0002-modular-monolith-with-npm-workspaces.md) | Modular monolith with npm workspaces                                        | Accepted | Structure         |
| [0003](0003-fastify-node-postgres-and-zod.md)        | Fastify 5, node-postgres and zod as a lean server stack                     | Accepted | Stack             |
| [0004](0004-postgresql-as-single-datastore.md)       | PostgreSQL as the single datastore, including log events                    | Accepted | Storage           |
| [0005](0005-forward-only-sql-migrations.md)          | Forward-only plain-SQL migrations with checksums                            | Accepted | Storage           |
| [0006](0006-tenant-isolation-by-organization-id.md)  | Tenant isolation by organization_id in repositories and in the compiler     | Accepted | Security          |
| [0007](0007-session-authentication.md)               | Session authentication with scrypt, hashed session tokens and CSRF          | Accepted | Security          |
| [0008](0008-login-and-registration-throttling.md)    | Login and registration throttling design                                    | Accepted | Security          |
| [0009](0009-daily-range-partitioning.md)             | Daily range partitioning of log_events and retention by dropping partitions | Accepted | Storage (domain)  |
| [0010](0010-in-house-lensql-recursive-descent.md)    | In-house LensQL with a hand-written recursive-descent parser                | Accepted | Query (domain)    |
| [0011](0011-compile-lensql-to-parameterised-sql.md)  | Compile LensQL to one parameterised SQL statement via placeholder fragments | Accepted | Query (domain)    |
| [0012](0012-two-valued-not-and-numeric-casts.md)     | Two-valued NOT semantics and non-throwing numeric casts for attributes      | Accepted | Query (domain)    |
| [0013](0013-query-guard-rails.md)                    | Query guard rails: read-only transactions, statement timeout, static limits | Accepted | Query (domain)    |
| [0014](0014-event-model-columns-and-jsonb.md)        | Event model: fixed columns plus jsonb attributes, GIN and trigram indexes   | Accepted | Storage (domain)  |
| [0015](0015-ingestion-api-keys.md)                   | Ingestion API keys: prefix lookup, SHA-256 at rest, constant-time compare   | Accepted | Ingest (domain)   |
| [0016](0016-ndjson-first-ingestion.md)               | NDJSON-first ingestion with per-line rejection and normalisation            | Accepted | Ingest (domain)   |
| [0017](0017-alert-evaluation.md)                     | Alert evaluation with a leased scheduler, state machine, EWMA, hysteresis   | Proposed | Alerting (domain) |
| [0018](0018-live-tail-listen-notify-websocket.md)    | Live tail via LISTEN/NOTIFY fan-out over WebSocket                          | Proposed | Search (domain)   |
| [0019](0019-local-outbox-for-notifications.md)       | Local outbox instead of external notification providers                     | Proposed | Notifications     |
