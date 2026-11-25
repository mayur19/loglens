# ADR-0011: Compile LensQL to one parameterised SQL statement via placeholder fragments

- **Status:** Accepted
- **Date:** 2026-11-21
- **Related:** ADR-0006, ADR-0010, ADR-0012, NFR-004, LG-023, LG-025

## Context

LensQL queries are untrusted input that must become efficient SQL. The compiler composes many pieces (tenant predicate, filters, numeric casts, `GROUP BY`, post-aggregation filters, `ORDER BY`, `LIMIT`). Tracking `$1..$n` indexes manually while composing recursively is error-prone, and string concatenation of values or identifiers is the root cause of SQL injection.

## Decision Drivers

- Zero user-controlled characters in SQL text (NFR-004).
- Composability: sub-expressions are compiled independently and nested.
- One round trip per search; the planner sees the whole query.
- Output that is easy to assert in tests.

## Considered Options

1. **Immutable fragments `{ text, params }` with anonymous `$?` placeholders, numbered once at the end.**
2. **Mutable parameter collector passed through recursion** — works, but order-dependent side effects make compilation impure and harder to test.
3. **Escape and inline literals (`quote_literal` style)** — fragile; one missed path is an injection.
4. **Build SQL through a query builder** — still needs care for identifiers, adds a dependency, and hides the final text from tests.

## Decision Outcome

Chosen option 1 (`packages/shared/src/lensql/sql.ts`):

- `sql(text, params)` asserts that the number of `$?` markers equals `params.length`.
- `composeSql('({} AND {})', a, b)` fills `{}` slots with sub-fragments and concatenates their params in order; `joinSql(parts, sep)` joins lists.
- `finalizeSql` replaces each `$?` with `$1, $2, ...` left to right, yielding `{ text, values }` for `pg`.
- Fragment text is assembled only from compiler-owned constants. Because the lexer never lets user text into a fragment's `text`, a literal `$?` typed by a user is just data inside `params`.

**Identifiers are never interpolated.** Built-in fields map through a fixed table to columns (`e.level`, `e.service`, ...). Any other field becomes a JSON path bound as a parameter: `(e.attributes #>> $?::text[])` with `['http','status']`. Output column names chosen by users (`as avg_ms`) map to compiler-assigned aliases (`g_time`, `g0..`, `a0..`, `f0..`); display names travel in the `columns` metadata, and post-stats references resolve through that mapping. Sort directions, aggregate functions and percentile fractions come from whitelists.

Literals are bound with explicit casts (`$?::numeric`, `$?::timestamptz`, `$?::text[]`, `$?::uuid`); numbers are passed as their original lexeme so `9999...9` (60 digits) cannot overflow JavaScript or alter the statement. `LIKE` patterns escape `\ % _` and translate `*` to `%`, with an explicit `ESCAPE '\'`.

The result is a single statement: events mode `SELECT ... FROM log_events e WHERE <tenant+time> AND <filters> ORDER BY ... LIMIT $n`, or table mode `SELECT * FROM (<aggregate>) t [WHERE <post>] ORDER BY ... LIMIT $n`.

## Consequences

- **Positive:** the injection suite (`packages/shared/test/lensql/injection.test.ts`) asserts no `DROP|DELETE|UNION|;|--|/*` ever appears in SQL text for hostile payloads in every literal position, and the API suite executes those payloads against PostgreSQL and verifies all tables survive.
- **Positive:** compiler tests compare exact SQL strings and parameter arrays.
- **Negative:** attribute paths repeated in numeric casts bind the same array several times (five copies per numeric comparison); harmless but slightly larger parameter lists.
