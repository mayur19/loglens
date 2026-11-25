# ADR-0004: PostgreSQL as the single datastore, including log events

- **Status:** Accepted
- **Date:** 2026-11-20
- **Related:** ADR-0009, ADR-0014, NFR-001, NFR-015

## Context

Log platforms typically pair a relational store (users, rules) with a specialised event store (Elasticsearch, ClickHouse, Loki). LogLens targets small and medium teams who self-host on one VM without containers. Every additional server is another thing to install, back up, secure and upgrade.

## Decision Drivers

- One backup/restore procedure (`pg_dump`) for everything (NFR-008).
- Native installation only, no containers (NFR-015).
- Target volume: up to ~10M events per tenant per day, searches over hours to days.
- Transactional consistency between metadata (API keys, alert state) and events where useful.

## Considered Options

1. **PostgreSQL only**, with declarative range partitioning, B-tree composite indexes, GIN on `jsonb`, and `pg_trgm` for substring search.
2. **PostgreSQL + Elasticsearch/OpenSearch** — excellent full-text search, but a JVM cluster to operate and a second consistency domain.
3. **PostgreSQL + ClickHouse** — superb columnar aggregation, but another server, another query dialect for the compiler, and weaker point lookups.
4. **Files on disk + in-house index** — maximum control, enormous engineering cost and risk.

## Decision Outcome

Chosen option 1. Events live in `log_events`, partitioned by day (ADR-0009), with fixed hot columns plus `attributes jsonb` (ADR-0014). The LensQL compiler targets PostgreSQL 15+ features (`date_bin`, `percentile_cont`, `jsonb #>>`, trusted `pg_trgm`).

## Consequences

- **Positive:** single dependency; CI uses the runner's preinstalled PostgreSQL; partitions give cheap retention.
- **Positive:** aggregation SQL (`GROUP BY`, `percentile_cont`) comes for free.
- **Negative:** row storage is less compact than columnar engines; capacity ceiling per node must be measured (LG-102, LG-221). If a tenant outgrows it, the compiler's backend boundary (`compileQuery` output) is the seam for an alternate store.
- **Negative:** free-text search is substring-based (trigram), not tokenised relevance ranking.
