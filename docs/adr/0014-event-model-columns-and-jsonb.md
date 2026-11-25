# ADR-0014: Event model: fixed columns plus jsonb attributes, GIN and trigram indexes

- **Status:** Accepted
- **Date:** 2026-11-22
- **Related:** ADR-0004, ADR-0009, ADR-0012, LG-027, LG-028

## Context

Log events are semi-structured. A handful of fields appear in nearly every event and dominate filters (time, level, service, host, message); the rest vary per service. Queries mix exact filters, substring search over messages and comparisons on arbitrary nested attributes.

## Decision Drivers

- Fast filtering on the common fields with composite B-tree indexes.
- Schema-free ingestion of arbitrary attributes, including nested objects.
- Substring search without a separate search engine.
- Predictable storage per event.

## Considered Options

1. **Fixed hot columns + `attributes jsonb`.**
2. **Everything in one `jsonb` document** — flexible, but every filter becomes a JSON extraction and composite indexes are awkward.
3. **Entity-attribute-value table** — fully dynamic, but joins per attribute and very poor scan performance.
4. **Dynamic `ALTER TABLE ADD COLUMN` per discovered field** — fast queries, but DDL on the hot path and unbounded column counts.

## Decision Outcome

Chosen option 1. `log_events` columns: `id`, `organization_id`, `api_key_id`, `timestamp`, `received_at`, `level` (checked enum of six canonical levels), `service`, `host`, `source`, `message`, `trace_id`, `attributes jsonb`. Indexes: `(organization_id, timestamp DESC)`, `(organization_id, service, timestamp DESC)`, `(organization_id, level, timestamp DESC)`, `GIN (attributes jsonb_path_ops)`, `GIN (message gin_trgm_ops)` (trusted `pg_trgm`, so the database owner can create it without superuser).

Normalisation (`packages/shared/src/ingest/normalize.ts`) maps aliases (`ts|@timestamp|time`, `lvl|severity`, `app`, `hostname`, `msg|log`, `traceId`) to columns, maps level names and pino numbers to the canonical set, keeps everything else as attributes, and enforces limits (message 32 KiB with truncation flag, attributes 16 KiB, depth 8). LensQL resolves `timestamp/_time, level, service, host, source, message/msg, trace_id` to columns and anything else to `attributes` paths.

## Consequences

- **Positive:** common filters use B-tree indexes after partition pruning; ILIKE free text can use the trigram index for patterns with three or more characters.
- **Negative:** `jsonb_path_ops` accelerates containment (`@>`) rather than `#>>` comparisons; the compiler may emit containment predicates for equality on attributes in a later optimisation. Trigram indexes add ingest cost (measured in LG-102).
- **Negative:** promoting a new hot attribute to a column requires a migration.
