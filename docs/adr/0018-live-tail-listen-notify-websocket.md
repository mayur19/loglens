# ADR-0018: Live tail via LISTEN/NOTIFY fan-out over WebSocket

- **Status:** Proposed
- **Date:** 2026-11-24
- **Related:** ADR-0004, ADR-0011, LG-140, LG-141, NFR-019

## Context

Users want to watch matching events arrive in real time (`service=checkout level=error`) with end-to-end latency under 2 seconds (NFR-019). Polling search every second multiplies database load by the number of viewers. No message broker may be added.

## Decision Drivers

- Sub-2-second latency.
- Database load independent of viewer count.
- Same filter semantics as LensQL search.
- Backpressure: a slow browser must not stall ingestion.

## Considered Options

1. **Ingest path publishes a compact batch notification with `pg_notify`; each API process holds one `LISTEN` connection and fans out to WebSocket subscribers; filters evaluated in process by an interpreter over the LensQL AST.**
2. **Per-viewer polling of `/search` with `timestamp > last_seen`** — simple, but N viewers = N queries per second.
3. **Logical replication / WAL decoding** — powerful, but requires replication slots and elevated privileges.
4. **External broker (Redis pub/sub, NATS)** — extra infrastructure.

## Decision Outcome

Chosen option 1 (M5). After each successful insert, the ingest handler calls `pg_notify('loglens_tail', '<org_id>:<first_id>:<last_id>')` — payloads stay far below the 8 KB limit because they carry an id range, not events. Each process fetches the referenced rows once (`WHERE organization_id = $1 AND id BETWEEN $2 AND $3`), then evaluates every subscriber's compiled predicate in memory using a small interpreter for the LensQL search subset (pipeline commands are not allowed in tail mode). Each WebSocket has a bounded send buffer (e.g. 1,000 events); on overflow the server drops events and sends a `{ "dropped": n }` marker rather than blocking. Authentication uses the session cookie plus a CSRF-style token in the upgrade query string; the route `GET /api/v1/tail` is already registered as pending.

## Consequences

- **Positive:** one extra cheap query per ingest batch per process, regardless of viewer count.
- **Negative:** two evaluators of LensQL semantics (SQL compiler and in-memory interpreter) must agree; a shared conformance test suite will run the same cases through both.
- **Negative:** NOTIFY is delivered only to connected listeners; tail is best effort, not a durable stream.
