# ADR-0012: Two-valued NOT semantics and non-throwing numeric casts for attributes

- **Status:** Accepted
- **Date:** 2026-11-22
- **Related:** ADR-0011, ADR-0014, LG-023

## Context

Most fields in logs are optional: an event may lack `user`, or carry `latency_ms: "n/a"`, or `http.status` as the string `"200"` from one service and the number `200` from another. SQL uses three-valued logic: a comparison with a missing value is `NULL`, and `NOT NULL` is still `NULL`, so the row is excluded. Users expect `service=auth NOT user=ann` to return auth events where the user is someone else **or absent**. Separately, a naive `(attributes->>'latency_ms')::numeric > 100` raises `invalid input syntax for type numeric` on the first non-numeric value and fails the entire search.

## Decision Drivers

- Predictable search semantics matching user intuition (Splunk-like).
- A single malformed event must never break a query.
- Keep predicates sargable where possible for index use.

## Considered Options

1. **Wrap each leaf predicate in `COALESCE(pred, false)`; compile numeric attribute access through a guarded `CASE`.**
2. **Keep raw SQL three-valued logic** — surprising results for `NOT` and `!=` over sparse fields.
3. **Rewrite `NOT x=v` as `x IS DISTINCT FROM v`** — handles one operator but not regex, IN or wildcard leaves uniformly.
4. **Cast with exception handling in a PL/pgSQL function** — correct, but a function call per row and opaque to the planner.

## Decision Outcome

Chosen option 1 (`packages/shared/src/lensql/compile-expr.ts`, `fields.ts`):

- Every comparison, regex, IN, wildcard and free-text leaf compiles to `COALESCE(<pred>, false)`. `AND`, `OR` and `NOT` then operate on strict booleans, so `NOT user=ann` is true when `user` is missing. Existence tests (`field=*`) are already two-valued.
- `!=` keeps "field present and different" semantics (`COALESCE(col <> $1, false)`), so `region!=eu` excludes events without a region, while `NOT region=eu` includes them. Both behaviours are documented for users.
- Numeric access: `CASE WHEN jsonb_typeof(attrs #> p) = 'number' THEN (attrs #>> p)::numeric WHEN jsonb_typeof(attrs #> p) = 'string' AND (attrs #>> p) ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN (attrs #>> p)::numeric END`. Non-numeric values become `NULL` and simply do not match; the regex is a compiler constant.
- Ordering operators (`> >= < <=`) require a numeric literal on an attribute, or a time value on `timestamp`; using them on text columns is a semantic error rather than surprising lexicographic comparison.
- Aggregates (`sum/avg/min/max/pNN`) reuse the same guarded expression, so `avg(latency_ms)` ignores `"n/a"`.

## Consequences

- **Positive:** verified against PostgreSQL: numeric strings match numeric comparisons, `"n/a"` is skipped, and `NOT user=ann` returns the event without a user (`ingest-search.db.test.ts`).
- **Negative:** `COALESCE` around a predicate can prevent some index usage for that leaf; the tenant/time predicate (outside any `COALESCE`) remains the primary access path. Expression indexes on hot attributes are a future optimisation driven by the field catalog (LG-135).
