# ADR-0013: Query guard rails: read-only transactions, statement timeout and static limits

- **Status:** Accepted
- **Date:** 2026-11-22
- **Related:** ADR-0011, NFR-005, LG-029, LG-137

## Context

Any authenticated viewer can submit arbitrary LensQL. Even perfectly parameterised SQL can be expensive: a 90-day regex scan, `span=1s` over a month, `dc()` over millions of messages, or a catastrophic PostgreSQL regex. One user must not be able to starve the database that also serves ingestion.

## Decision Drivers

- Bound CPU, memory and result size per query.
- Defence in depth if a compiler bug ever produced a writing statement.
- Fail fast with actionable errors (422 with a hint), not 500s.

## Considered Options

1. **Static limits in the front end + per-query `READ ONLY` transaction + local `statement_timeout`.**
2. **Separate read-only database role for searches** — strong, but doubles pool configuration; may be added later.
3. **Cost-based admission via `EXPLAIN`** — catches expensive plans before execution; valuable but more complex (LG-137).

## Decision Outcome

Chosen option 1, with option 3 planned:

- Static limits (`packages/shared/src/lensql/limits.ts`): query 4,000 chars, 512 tokens, nesting depth 32, strings 1,024, regex 256, IN 100 values, 10 aggregations, 5 group-by fields, 25 projected fields, 8 path segments, `head` ≤ 10,000, stats buckets ≤ 10,000 per group (`ceil(range / span)`), time range ≤ 90 days, row cap `QUERY_MAX_ROWS` (10,000).
- Execution (`apps/api/src/modules/search/search.service.ts`): `BEGIN READ ONLY`, `SELECT set_config('statement_timeout', $1, true)` (transaction-local, default 5,000 ms), run, `COMMIT`. Errors map to stable codes: `57014` → `QUERY_TIMEOUT`, `2201B`/`22P02`/`22023` (invalid regex/values) → `QUERY_FAILED`, compile errors → `QUERY_INVALID` with span — all HTTP 422.
- Histogram bucket width is chosen from a fixed list (1 s … 7 d) so the bar count never exceeds the requested target (≤ 500).

## Consequences

- **Positive:** a pathological regex over 30,000 rows with a 1 ms timeout returns `QUERY_TIMEOUT` (tested); writes are impossible inside the search transaction.
- **Negative:** legitimate heavy queries may time out; users narrow the range or add indexed filters, and dashboards will rely on caching (LG-138). Limits are constants today; per-tenant overrides belong with quotas (LG-112).
