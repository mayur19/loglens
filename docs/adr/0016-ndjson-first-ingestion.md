# ADR-0016: NDJSON-first ingestion with per-line rejection and normalisation

- **Status:** Accepted
- **Date:** 2026-11-23
- **Related:** ADR-0014, ADR-0015, LG-028, LG-100, LG-110

## Context

Shippers send batches. A single malformed line in a batch of 5,000 should not discard the other 4,999, and the shipper needs to know which lines failed. The product must support syslog (RFC 5424/3164) eventually, but JSON-structured logging is the dominant modern format.

## Decision Drivers

- Partial success with precise feedback.
- One SQL round trip per batch.
- Bounded memory and CPU per request.
- A format compatible with common shippers' HTTP sinks.

## Considered Options

1. **NDJSON (and JSON object/array) first, syslog later; normalise per event; insert accepted events with one `INSERT ... SELECT FROM unnest(...)` statement.**
2. **All-or-nothing JSON array** — simpler semantics, but one bad record loses the batch.
3. **Syslog first** — legacy-friendly, but unstructured; attribute extraction depends on pipelines (LG-121).
4. **gRPC/OTLP** — rich, but large dependency surface; may be added later behind the same normaliser.

## Decision Outcome

Chosen option 1. `POST /api/v1/ingest` accepts `application/x-ndjson`, `application/jsonl` or `text/plain` (parsed as NDJSON in an encapsulated Fastify scope with `INGEST_MAX_BODY_BYTES`, default 5 MiB) and `application/json` (one object or an array). `parseNdjson` skips blank lines, handles CRLF, rejects batches over `INGEST_MAX_EVENTS_PER_REQUEST` (5,000) with 413 before normalising, and reports each bad line as `{line, reason}` (invalid JSON, not an object, unparseable timestamp, older than 30 days, nesting too deep, attributes over 16 KiB). The response is `202 {accepted, rejectedCount, rejected}` with at most 50 rejection entries. Accepted events are written by `insertEvents` with ten array parameters expanded by `unnest`, so cost is one parse and one round trip per batch. The key's `default_service` fills a missing service.

## Consequences

- **Positive:** tested partial acceptance, caps and limits; ingestion latency dominated by one insert.
- **Negative:** no backpressure yet beyond body limits — a queue with 429/Retry-After (LG-100) and COPY-based writes (LG-101) are pending; very large batches hold a pool connection for the insert duration.
- **Negative:** rejected events are reported but not stored; a dead-letter table is LG-105.
