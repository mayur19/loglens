# ADR-0009: Daily range partitioning of log_events and retention by dropping partitions

- **Status:** Accepted
- **Date:** 2026-11-22
- **Related:** ADR-0004, ADR-0014, LG-027, LG-190, LG-191, NFR-017

## Context

Log data is append-mostly, queried by recent time ranges, and expires by age. With a single heap table, retention means `DELETE ... WHERE timestamp < X`: slow, WAL-heavy, leaves bloat for vacuum, and contends with ingestion. Every LensQL query is bounded by a time range (ADR-0013).

## Decision Drivers

- Constant-time retention independent of row count.
- Queries over the last hours must touch only recent data (partition pruning).
- No row may be rejected because its partition does not exist yet.
- Works on stock PostgreSQL 15+ without extensions such as TimescaleDB or pg_partman.

## Considered Options

1. **Declarative `PARTITION BY RANGE (timestamp)` with one partition per UTC day, plus a `DEFAULT` partition.**
2. **Hourly partitions** — finer retention, but 720+ partitions per month inflates planning time and catalog size.
3. **Partition by tenant then time** — better per-tenant retention, but partitions × tenants explodes; tenant is already the leading index column.
4. **TimescaleDB hypertables** — excellent, but a non-core extension that operators must install and that changes licensing considerations.

## Decision Outcome

Chosen option 1 (`apps/api/migrations/0002_ingestion_and_search.sql`):

- `log_events` has primary key `(timestamp, id)` (the partition key must be part of unique constraints). Indexes declared on the parent cascade to every partition.
- `loglens_ensure_daily_partitions(p_from date, p_to date)` creates `log_events_pYYYYMMDD` for each missing day with bounds `[d 00:00 UTC, d+1 00:00 UTC)`, validates the window (≤ 400 days, ordered) and returns how many partitions it created. It uses `format('%I', ...)`/`%L` so names and bounds are quoted safely.
- The migration pre-creates `today-31 .. today+7`. The API calls `ensurePartitions` at boot and, via `createPartitionKeeper`, at most once per UTC day on the ingest path (`apps/api/src/db/partitions.ts`). Ingestion accepts timestamps no older than 30 days and clamps those more than 10 minutes in the future, so normal traffic always lands in a daily partition (verified by a test that inspects `tableoid`).
- `log_events_default` catches anything outside existing partitions. It must stay empty: PostgreSQL refuses to create a partition whose range overlaps rows already in the default partition. The partition manager (LG-191) will detect and drain it.
- **Pruning:** the compiler always emits `e.timestamp >= $2 AND e.timestamp < $3` as bound parameters, so the planner prunes partitions at execution time even for prepared statements.
- **Retention (pending LG-190/191):** a scheduled job computes the oldest partition to keep per policy and runs `ALTER TABLE log_events DETACH PARTITION ... CONCURRENTLY` followed by `DROP TABLE` (optionally after archiving, LG-192). Because partitions are per day and shared by tenants, per-tenant retention shorter than the global maximum is enforced by query-time filtering plus a background `DELETE` on the oldest partition only.

## Consequences

- **Positive:** dropping a day is O(1) and produces no bloat; recent searches scan a handful of partitions.
- **Negative:** queries spanning the full 90-day limit touch ~90 partitions; planning cost is acceptable but measured in LG-221.
- **Negative:** if the process stops for more than seven days, new days fall into the default partition until the manager drains it; the runbook documents the recovery.
