# Runbook

Day-to-day operation of a LogLens instance: configuration, database lifecycle, backups, partition maintenance and troubleshooting. For installing on a server, see [deployment.md](deployment.md).

## 1. Configuration

All configuration comes from environment variables. In development they are read from `.env` at the repository root, which `./run.sh setup` creates from `.env.example`. `apps/api/src/config/env.ts` validates them at startup. Any invalid value stops the process with a message listing every problem.

| Variable                        | Default                                | Valid values                                            | Purpose                                                                                                                                             |
| ------------------------------- | -------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | `development`                          | `development`, `test`, `production`                     | `production` turns on Secure cookies, requires `TRUST_PROXY`, and makes `reset` refuse to run                                                       |
| `API_HOST`                      | `127.0.0.1`                            | host/IP                                                 | Interface the API binds to                                                                                                                          |
| `API_PORT`                      | `4109`                                 | 1–65535                                                 | API port                                                                                                                                            |
| `WEB_PORT`                      | `5109`                                 | port                                                    | Vite dev server port (development only)                                                                                                             |
| `WEB_ORIGIN`                    | `http://localhost:5109`                | URL                                                     | Public origin of the SPA                                                                                                                            |
| `LOG_LEVEL`                     | `info`                                 | `fatal`…`trace`, `silent`                               | Pino log level                                                                                                                                      |
| `DATABASE_URL`                  | — (required)                           | PostgreSQL URL                                          | e.g. `postgresql:///loglens_dev?host=/tmp` (unix socket, OS user, no password)                                                                      |
| `TEST_DATABASE_URL`             | `postgresql:///loglens_test?host=/tmp` | PostgreSQL URL                                          | Database the test suite **drops and recreates**                                                                                                     |
| `SESSION_SECRET`                | — (required)                           | ≥ 32 chars                                              | Instance secret; `run.sh` writes 64 random hex characters                                                                                           |
| `SESSION_TTL_HOURS`             | `12`                                   | 1–720                                                   | Session lifetime                                                                                                                                    |
| `TRUST_PROXY`                   | `false` (required in production)       | `false`, hop count `1`–`10`, or comma list of IPs/CIDRs | Which `X-Forwarded-For` hops are believed; feeds the IP rate limiters. See [threat-model.md §6](../security/threat-model.md#6-trust_proxy-guidance) |
| `QUERY_TIMEOUT_MS`              | `5000`                                 | 100–60000                                               | Per-search `statement_timeout`                                                                                                                      |
| `QUERY_MAX_ROWS`                | `10000`                                | 1–10000                                                 | Hard cap on rows a search returns                                                                                                                   |
| `INGEST_MAX_BODY_BYTES`         | `5242880`                              | 1024–52428800                                           | Maximum ingest request body                                                                                                                         |
| `INGEST_MAX_EVENTS_PER_REQUEST` | `5000`                                 | 1–50000                                                 | Maximum events per ingest request                                                                                                                   |

## 2. Everyday commands

```bash
./run.sh setup     # prerequisites, .env, npm install, create loglens_dev + loglens_test, migrate, seed
./run.sh dev       # API on :4109, web on :5109
./run.sh migrate   # apply pending migrations (npm run db:migrate)
./run.sh seed      # demo org, owner/viewer users, demo key, 20 000 events (idempotent)
./run.sh reset     # DROP SCHEMA public CASCADE, migrate, seed (refused in production)
./run.sh test      # lint, format check, typecheck, all tests against TEST_DATABASE_URL
```

Production equivalents run the bundled CLI directly:

```bash
node --env-file=/etc/loglens/loglens.env apps/api/dist/db/cli.js migrate
```

### Migrations

- Plain SQL files in `apps/api/migrations/NNNN_name.sql`, forward-only.
- `schema_migrations(version, name, checksum, applied_at)` records what has run. Each file runs in its own transaction.
- A PostgreSQL advisory lock (`hashtext('loglens:migrate')`) serialises concurrent runners.
- Never edit a migration that has been applied. Add a new one instead.

### Health checks

| Endpoint      | Meaning                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /health` | The process is up (no DB access)                                                                       |
| `GET /ready`  | The database is reachable and `schema_migrations` exists; returns the migration count. `503` otherwise |

## 3. Backup and restore

`log_events` is a partitioned table. `pg_dump` handles the parent, every `log_events_pYYYYMMDD` partition and `log_events_default` as normal tables, and dumps the partition-creation function too.

### Backup (nightly, RPO ≤ 24 h — NFR-008)

```bash
pg_dump -h /tmp -d loglens_prod -Fc -Z 6 -f /var/backups/loglens/loglens-$(date -u +%Y%m%dT%H%M%SZ).dump
# keep 14 days
find /var/backups/loglens -name 'loglens-*.dump' -mtime +14 -delete
```

To dump only recent event data (for a quick copy to staging), use `--table='log_events_p2026*'` together with the non-event tables. Full dumps are the supported path.

### Restore (RTO ≤ 2 h)

```bash
sudo systemctl stop loglens-api
createdb -h /tmp loglens_restore
pg_restore -h /tmp -d loglens_restore --no-owner --jobs 4 /var/backups/loglens/loglens-<stamp>.dump
psql -h /tmp -d loglens_restore -c "SELECT count(*) FROM schema_migrations;"
psql -h /tmp -d loglens_restore -c "SELECT loglens_ensure_daily_partitions(current_date - 31, current_date + 7);"
# point DATABASE_URL at loglens_restore (or rename databases), then
sudo systemctl start loglens-api && curl -fsS http://127.0.0.1:4109/ready
```

`pg_restore` recreates partitions before loading their rows, so attachments keep working. After a restore, check that the newest partitions exist (the last command above) so ingestion for "today" does not fall into the default partition.

## 4. Partition maintenance

- Partitions are daily: `log_events_pYYYYMMDD` covers `[day 00:00 UTC, next day 00:00 UTC)`.
- `loglens_ensure_daily_partitions(from date, to date)` is idempotent and returns how many partitions it created. It rejects windows longer than 400 days or inverted.
- The API calls it at startup for `today-31 .. today+7` (`apps/api/src/index.ts`) and again on the first ingest of each UTC day (`createPartitionKeeper` in `apps/api/src/db/partitions.ts`).
- Retention by dropping partitions and draining the default partition are automated by LG-190/LG-191. Until then, do it by hand:

```sql
-- inventory
SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid))
  FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
 WHERE i.inhparent = 'log_events'::regclass ORDER BY 1;

-- anything here means ingestion wrote outside every daily partition
SELECT count(*), min(timestamp), max(timestamp) FROM log_events_default;

-- manual retention (keeps 30 days): drop old partitions
DROP TABLE IF EXISTS log_events_p20260101;
```

Dropping a partition is instant and reclaims disk at once, unlike `DELETE`.

## 5. Troubleshooting

| Symptom                                                                                                        | Likely cause                                                                                                                                               | Action                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403 CSRF_INVALID` on every POST from the SPA                                                                  | The `ll_csrf` cookie is missing (blocked third-party cookies, different origin) or a proxy strips the `x-csrf-token` header                                | Serve SPA and API from the same origin; make sure nginx forwards custom headers; `GET /api/v1/auth/csrf` re-issues the cookie                                                                                                                                             |
| `403 CSRF_INVALID` from a script                                                                               | Scripts must call `GET /api/v1/auth/csrf`, keep cookies, and echo the token in `x-csrf-token`. Only `/api/v1/ingest` is exempt                             | —                                                                                                                                                                                                                                                                         |
| `429 RATE_LIMITED` on login                                                                                    | Email lockout (5 failures per 15 min, then 1 s doubling up to 15 min), IP spray lock (30 attempts per 15 min), or more than 20 distinct emails from one IP | Wait for `Retry-After`. Restarting the API clears the in-process counters, but only do that during an incident review                                                                                                                                                     |
| Every user behind the proxy is rate-limited together                                                           | `TRUST_PROXY=false` behind nginx, so all requests appear to come from 127.0.0.1                                                                            | Set `TRUST_PROXY=1` (one local proxy) and restart                                                                                                                                                                                                                         |
| `429` on register                                                                                              | 5 registrations per IP per hour                                                                                                                            | Wait an hour or register from another network                                                                                                                                                                                                                             |
| `422 QUERY_TIMEOUT`                                                                                            | The search exceeded `QUERY_TIMEOUT_MS`                                                                                                                     | Narrow the time range, filter on `service`/`level` (indexed), avoid leading-wildcard regexes; raise the timeout only after checking `EXPLAIN`                                                                                                                             |
| `422 QUERY_FAILED`                                                                                             | PostgreSQL rejected a regex at execution (`2201B`)                                                                                                         | Fix the pattern; LensQL regexes use PostgreSQL ARE syntax                                                                                                                                                                                                                 |
| `422 QUERY_INVALID`                                                                                            | LensQL syntax or semantic error                                                                                                                            | `details.span` points at the offending characters                                                                                                                                                                                                                         |
| Startup: `Migration 0002_... was modified after being applied`                                                 | A migration file was edited after it ran                                                                                                                   | Restore the original file from git and put the change in a new migration                                                                                                                                                                                                  |
| Startup: `TRUST_PROXY must be set explicitly in production`                                                    | Production config without `TRUST_PROXY`                                                                                                                    | Set `false`, a hop count or proxy CIDRs                                                                                                                                                                                                                                   |
| `ERROR: updated partition constraint for default partition "log_events_default" would be violated by some row` | Rows for a day landed in the default partition before its daily partition existed, so creating that partition now conflicts                                | Inside a transaction: `CREATE TABLE tmp AS SELECT * FROM log_events_default WHERE timestamp >= '<day>' AND timestamp < '<day+1>'`; delete those rows from the default; run `loglens_ensure_daily_partitions('<day>','<day>')`; `INSERT INTO log_events SELECT * FROM tmp` |
| `/ready` returns 503                                                                                           | Database down or not migrated                                                                                                                              | `pg_isready -h /tmp`; `./run.sh migrate`                                                                                                                                                                                                                                  |
| `401` on ingest                                                                                                | Missing `Authorization: Bearer llk_...`, wrong key, or revoked key                                                                                         | Create a new key under Ingestion keys; the token is only shown once                                                                                                                                                                                                       |
| `413 PAYLOAD_TOO_LARGE` on ingest                                                                              | Batch over `INGEST_MAX_EVENTS_PER_REQUEST` or `INGEST_MAX_BODY_BYTES`                                                                                      | Split batches (shippers should send ≤ 1 000 events per request)                                                                                                                                                                                                           |
