# User stories

Stories are grouped by epic (E1–E11, matching [backlog.md](../planning/backlog.md)). Each story lists
its tickets, requirement(s) and status: **Implemented** stories are covered by automated tests on
`main`; **Pending** stories describe the planned behaviour that the ticket must deliver.

## E1 Platform

### US-1.1 One-command local setup — Implemented (LG-007, LG-033)

As a platform operator, I want a single launcher so that I can run LogLens on a fresh machine.

- **Given** Node.js 22+ and a local PostgreSQL reachable over `/tmp`, **when** I run `./run.sh setup`,
  **then** `.env` is created with a random `SESSION_SECRET`, `loglens_dev` and `loglens_test` exist,
  migrations `0001` and `0002` are applied and 20,000 demo events are seeded.
- **Given** setup already ran, **when** I run it again, **then** nothing is duplicated
  ("Demo data already present").

### US-1.2 Safe schema evolution — Implemented (LG-004)

As an operator, I want migrations to be forward-only and verified so that upgrades are predictable.

- **Given** an applied migration file is edited, **when** the runner starts, **then** it stops with a
  checksum error naming the file.
- **Given** a migration fails halfway, **when** it is rolled back, **then** no partial tables remain and
  `schema_migrations` has no row for it.

### US-1.3 Health probes — Implemented (LG-006)

- **Given** the API runs, **when** nginx probes `/health`, **then** it receives `200 {status:"ok"}`.
- **Given** the database is unreachable, **when** `/ready` is called, **then** it answers `503`.

### US-1.4 Honest API surface — Implemented (LG-034)

As an integrator, I want unfinished endpoints to exist and say so, so that clients can be built
against the full contract.

- **Given** I am signed in, **when** I call `GET /api/v1/dashboards`, **then** I receive `501` with
  `error.code = NOT_IMPLEMENTED` and `details.ticket = "LG-150"`.

## E2 Identity & access

### US-2.1 Create a workspace — Implemented (LG-010, FR-001)

As a team lead, I want to register my organization so that my team can start sending logs.

- **Given** valid details, **when** I submit the registration form, **then** I see "Sign in with your
  email and password to continue" and can sign in as owner.
- **Given** the email is already registered, **when** someone registers with it, **then** they see the
  identical message and no account is created or modified.
- **Given** five registrations from my IP in the last hour, **when** I try a sixth, **then** I get
  `429` with `Retry-After`.

### US-2.2 Sign in and out — Implemented (LG-011, LG-012, FR-002..FR-006)

- **Given** correct credentials, **when** I sign in, **then** an HttpOnly, SameSite=Lax session cookie
  is set and the search screen opens.
- **Given** a wrong password or unknown email, **when** I sign in, **then** I see "Invalid email or
  password" in both cases.
- **Given** I am signed in, **when** I sign out, **then** the session row is deleted and reusing the old
  cookie returns `401`.
- **Given** a cross-site form posts to the API, **when** it lacks the `x-csrf-token` header matching
  `ll_csrf`, **then** the request is refused with `403 CSRF_INVALID`.

### US-2.3 Brute-force protection — Implemented (LG-013, NFR-010)

As a security officer, I want guessing attacks throttled without locking out unrelated users.

- **Given** five failed attempts for one email from any mix of IPs, **when** a sixth arrives, **then** it
  is refused for 1 s, and each further failure doubles the lock up to 15 minutes.
- **Given** twelve parallel bad logins for one email, **when** they race, **then** exactly five reach
  password verification and seven receive `429`.
- **Given** one IP tries 20 different emails in 15 minutes, **when** it tries a 21st, **then** it is
  refused while other IPs can still sign in.

### US-2.4 Role-based access — Implemented (LG-014, FR-007)

- **Given** I am a viewer, **when** I try to create an ingestion key, **then** I get `403`; **when** I
  search, **then** I get results.

### US-2.5 Audit trail — Implemented (LG-015, FR-008)

- **Given** any login, failed login, logout or key change, **when** it happens, **then** an
  `audit_events` row records actor, organization, IP and request ID.
- **Given** an attacker with SQL access tries `UPDATE audit_events`, **then** the trigger raises
  "audit_events is append-only".

### US-2.6 Invite teammates — Pending (LG-200, LG-201, LG-202, FR-067, FR-068)

- **Given** I am an admin, **when** I invite `dev@acme.test` as member, **then** a single-use token valid
  7 days is written to the outbox.
- **Given** I am the last owner, **when** I try to demote myself, **then** the change is rejected.

### US-2.7 Recover access and verify email — Pending (LG-210, LG-211, FR-069, FR-070)

- **Given** I forgot my password, **when** I request a reset, **then** the response is identical whether
  or not the account exists, and completing the reset revokes all my sessions.
- **Given** I registered, **when** I have not verified my email, **then** I cannot sign in.

### US-2.8 Multi-factor authentication — Pending (LG-212, LG-213, FR-071)

- **Given** MFA is required by my organization, **when** I sign in with only a password, **then** I am
  asked for a TOTP code before a session is issued.

## E3 LensQL engine

### US-3.1 Filter logs precisely — Implemented (LG-020..LG-023, FR-015..FR-020)

As an on-call engineer, I want to combine text, field and regex filters so that I can isolate the
failing requests.

- **Given** events from several services, **when** I search `service=checkout http.status>=500`,
  **then** only checkout events with numeric status ≥ 500 are returned, newest first.
- **Given** some events store status as the string `"200"`, **when** I search `http.status=200`,
  **then** they match too, and events where status is `"n/a"` are skipped without an error.
- **Given** I search `NOT user=ann`, **then** events with no `user` attribute are included.

### US-3.2 Aggregate with stats — Implemented (LG-023, FR-022..FR-024)

- **Given** latency attributes, **when** I run
  `| stats count() as n, avg(latency_ms) as avg_ms, p50(latency_ms) by service | sort -n`,
  **then** I receive one row per service with the computed values, largest `n` first.
- **Given** `level=error | stats count() by service span=1h`, **then** rows contain an hour-aligned
  `_time` column ordered by time.
- **Given** `| stats count() as n by host | where n>=2`, **then** only hosts with at least two events
  are returned.

### US-3.3 Understand my mistakes — Implemented (LG-021, LG-029, FR-026)

- **Given** I type `level=error | bogus`, **when** I run it, **then** the API returns `422 QUERY_INVALID`
  with span `{start:14,end:19}` and the UI underlines `bogus`.
- **Given** I type `service>api`, **then** I am told `>` needs a numeric value, before any database
  work happens.

### US-3.4 Queries cannot hurt the system — Implemented (LG-025, NFR-004..NFR-006)

As a security officer, I want every query to be safe by construction.

- **Given** a query containing `"'; DROP TABLE log_events; --"`, **when** it runs, **then** the text is
  bound as a parameter, zero rows match and every table still exists.
- **Given** a regex that would scan millions of rows, **when** it exceeds 5 s, **then** the query is
  cancelled and `422 QUERY_TIMEOUT` is returned.
- **Given** two organizations, **when** one searches with `OR` at the top level, **then** it still sees
  only its own events.

### US-3.5 Extended commands — Pending (LG-131, LG-132, LG-133, FR-046)

- **Given** raw nginx lines, **when** I run `| rex field=message "(?<status>\d{3}) (?<bytes>\d+)"`,
  **then** `status` and `bytes` become columns usable by `stats`.

### US-3.6 Query cost guard — Pending (LG-137)

- **Given** a query whose estimated cost exceeds the tenant budget, **when** I run it, **then** I am
  asked to narrow the range before execution.

## E4 Ingestion

### US-4.1 Ship logs with a key — Implemented (LG-026, LG-028, FR-009..FR-014)

As a backend developer, I want to send NDJSON with an API key so that my service's logs are
searchable within seconds.

- **Given** an admin created a key, **when** I POST two NDJSON lines with `Authorization: Bearer llk_…`,
  **then** I get `202 {accepted:2, rejectedCount:0}` and the events are searchable.
- **Given** a batch where line 3 is invalid JSON, **then** the other lines are stored and the response
  lists `{line:3, reason:"invalid JSON"}`.
- **Given** the key is revoked, **when** I send again, **then** I get `401`.
- **Given** more than 5,000 events or more than 5 MiB, **then** I get `413 PAYLOAD_TOO_LARGE`.

### US-4.2 Syslog devices — Pending (LG-110, LG-111, FR-031)

- **Given** a router emitting RFC 5424, **when** it posts to `/api/v1/ingest/syslog`, **then** severity
  maps to level and APP-NAME to service.

### US-4.3 Quotas and backpressure — Pending (LG-100, LG-112, LG-113, FR-032, FR-033)

- **Given** my tenant exceeded its daily quota, **when** I send more, **then** I get `429` with the
  reset time and other tenants are unaffected.
- **Given** the ingest queue is full, **then** shippers receive `429 Retry-After` instead of the API
  running out of memory.

### US-4.4 Reliable delivery — Pending (LG-103, LG-104, LG-105, FR-034..FR-036)

- **Given** a shipper retries with the same `Idempotency-Key`, **then** no duplicates are stored.
- **Given** lines were rejected, **when** an admin opens the dead-letter view, **then** they see the raw
  line and reason for 7 days.

## E5 Pipelines

### US-5.1 Extract fields from text logs — Pending (LG-120..LG-125, FR-037..FR-040)

- **Given** a pipeline `%{IP:client} %{WORD:method} %{URIPATH:path} %{INT:status}` for
  `source=nginx`, **when** a matching line is ingested, **then** `client`, `method`, `path` and numeric
  `status` are stored as attributes.
- **Given** I edit a pattern, **when** I click "Test" with sample lines, **then** I see the extracted
  fields per line without storing anything.
- **Given** a line does not match, **then** it is stored unchanged with `_pipeline_error`.

## E6 Search experience

### US-6.1 Visual search screen — Implemented (LG-030, LG-031, FR-027..FR-029)

- **Given** I open Search, **when** the page loads, **then** the last 24 h histogram and newest events
  are shown.
- **Given** I click an example query chip, **then** it fills the query bar and runs.
- **Given** stats output, **then** the table switches to "Statistics" with right-aligned numbers.

### US-6.2 Manage ingestion keys — Implemented (LG-032, FR-030)

- **Given** I am an admin, **when** I create a key, **then** the token and a ready-to-run `curl`
  example are shown once; after reload only the prefix is visible.

### US-6.3 Planned sections are visible — Implemented (LG-030)

- **Given** I open the navigation, **then** Live tail, Saved searches, Dashboards, Alerts, Incidents,
  Pipelines and Settings show a "Planned" badge and a page naming their ticket.

### US-6.4 Saved searches — Pending (LG-130, FR-041)

- **Given** a useful query, **when** I save it as "checkout 5xx" with organization visibility, **then**
  teammates can open it from Saved searches.

### US-6.5 Live tail — Pending (LG-140, LG-141, FR-042)

- **Given** I start a tail with `service=checkout level=error`, **when** a matching event is ingested,
  **then** it appears within 2 s; **when** I pause, new events are buffered up to a limit.

### US-6.6 Export and field discovery — Pending (LG-134..LG-136, FR-043..FR-045)

- **Given** a result set, **when** I export as CSV, **then** the download streams without loading
  everything into memory.
- **Given** I type `http.`, **then** the editor suggests `http.status`, `http.path`, `http.method`.

## E7 Dashboards

### US-7.1 Service health dashboard — Pending (LG-150..LG-154, FR-047..FR-050)

- **Given** I add a panel with `level=error | stats count() by service span=5m`, **then** a line chart
  per service is drawn with axes and tooltips.
- **Given** a `$service` variable, **when** I pick `billing`, **then** every panel re-runs with the value
  bound as a literal.
- **Given** auto-refresh every 30 s, **then** identical panel queries run once per refresh.

## E8 Alerting

### US-8.1 Threshold alerts — Pending (LG-160, LG-161, LG-163, FR-051..FR-053, FR-056)

- **Given** a rule `level=error | stats count() by service` with condition `count() > 50` every
  minute over 5 minutes, **when** checkout logs 80 errors, **then** the checkout group goes
  pending → firing and exactly one notification is sent.
- **Given** two scheduler workers, **then** each evaluation runs exactly once.

### US-8.2 Anomaly alerts — Pending (LG-165, FR-054)

- **Given** an EWMA rule with k = 3, **when** p95 latency jumps from a stable 120 ms to 900 ms, **then**
  the rule fires after warm-up, without a fixed threshold.

### US-8.3 No flapping — Pending (LG-166, FR-055)

- **Given** a value oscillating around the threshold, **when** hysteresis and minimum durations are
  configured, **then** at most one fire/resolve pair is produced per window.

### US-8.4 Acknowledge, silence, backtest — Pending (LG-162, LG-164, LG-167, FR-057, FR-058)

- **Given** a firing alert, **when** I acknowledge it, **then** reminders stop but history is kept.
- **Given** a draft rule, **when** I preview it over the last 7 days, **then** I see the transitions it
  would have produced.

## E9 Incidents & notifications

### US-9.1 Notifications without external providers — Pending (LG-170..LG-173, FR-059, FR-060)

- **Given** a webhook channel, **when** an alert fires, **then** an outbox row is written in the same
  transaction and the local worker delivers it with exponential backoff.
- **Given** an in-app channel, **then** the bell in the shell shows the unread count.

### US-9.2 Incident timeline — Pending (LG-180..LG-182, FR-061, FR-062)

- **Given** a firing alert, **when** I open an incident from it, **then** the timeline shows the alert
  transitions, my notes and linked searches in order and can be exported for the post-mortem.

## E10 Storage & retention

### US-10.1 Retention by policy — Pending (LG-190, LG-191, FR-063, FR-064, NFR-017)

- **Given** a 14-day retention, **when** the partition manager runs, **then** data older than 14 days is
  removed within 1 h of the boundary and partitions older than every tenant's retention are dropped.
- **Given** rows landed in `log_events_default`, **then** the job moves them into proper partitions.

### US-10.2 Archive and usage — Pending (LG-192, LG-193, FR-065, FR-066)

- **Given** archiving is enabled, **when** a partition is due for drop, **then** it is exported to local
  disk with a checksum manifest first.

## E11 Operations

### US-11.1 Operate in production — Pending (LG-220..LG-225)

- **Given** LogLens runs under systemd behind nginx, **when** I scrape `/metrics`, **then** I see ingest
  rate, query latency histograms and partition counts.
- **Given** the nightly `pg_dump`, **when** the restore drill runs, **then** a scratch database is
  restored and verified within 2 h (NFR-008).
