# LogLens HTTP API

The machine-readable contract is [openapi.yaml](openapi.yaml) (OpenAPI 3.1). It describes the
**full target API**: 14 operations are implemented and 45 are registered as pending. Every
operation has `x-status: implemented | pending`; pending operations also carry `x-ticket` and
answer `501 NOT_IMPLEMENTED` today, so clients can be written against the final surface.

Base URL in development: `http://127.0.0.1:4109` (the web app on port 5109 proxies `/api`).

## Conventions

- JSON in and out (`content-type: application/json`), except ingestion which also accepts NDJSON.
- Every response uses one envelope:

  ```json
  { "data": { "...": "..." }, "error": null, "meta": { "total": 3 } }
  { "data": null, "error": { "code": "QUERY_INVALID", "message": "…", "details": { "span": { "start": 14, "end": 19 } } } }
  ```

- Request bodies are validated with zod schemas from `packages/shared/src/schemas`; unknown
  properties are rejected on search endpoints (`strict`).
- Timestamps are ISO-8601 UTC strings. IDs are UUIDs (log event ids are bigint strings).
- Every response carries `x-request-id` (an incoming well-formed `x-request-id` is echoed),
  `cache-control: no-store` and `x-content-type-options: nosniff`.
- Versioning is in the path (`/api/v1`). Additive changes only within v1.

## Errors

| HTTP | `error.code`        | When                                                                                             |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`  | Body/params fail validation (`details` lists `{ path, message }`), malformed JSON, empty ingest. |
| 401  | `UNAUTHENTICATED`   | No/expired session, bad credentials (generic message), missing or revoked API key.               |
| 403  | `FORBIDDEN`         | Role lacks the permission (e.g. viewer creating API keys).                                       |
| 403  | `CSRF_INVALID`      | Missing or mismatched `x-csrf-token` on a mutating request.                                      |
| 404  | `NOT_FOUND`         | Unknown route or resource outside your organization.                                             |
| 413  | `PAYLOAD_TOO_LARGE` | Ingest body over `INGEST_MAX_BODY_BYTES` or more events than `INGEST_MAX_EVENTS_PER_REQUEST`.    |
| 422  | `QUERY_INVALID`     | LensQL could not be parsed/analysed; `details = { lensqlCode, span }`.                           |
| 422  | `QUERY_TIMEOUT`     | Statement exceeded `QUERY_TIMEOUT_MS` (narrow the range or add filters).                         |
| 422  | `QUERY_FAILED`      | Database rejected the query at execution (for example an invalid regular expression).            |
| 429  | `RATE_LIMITED`      | Login/registration throttled; `Retry-After` header and `details.retryAfterSeconds`.              |
| 501  | `NOT_IMPLEMENTED`   | Pending operation; `details.ticket` names the backlog item.                                      |
| 500  | `INTERNAL`          | Unexpected failure (logged with the request id; no internals in the body).                       |

## Authentication

### Browser sessions + CSRF

1. `GET /api/v1/auth/csrf` sets the readable `ll_csrf` cookie and returns the token.
2. Every non-GET request under `/api/` (except `/api/v1/ingest*`) must send the same value in
   the `x-csrf-token` header (double submit, compared in constant time).
3. `POST /api/v1/auth/login` sets `ll_session` (HttpOnly, SameSite=Lax, Secure in production,
   expires after `SESSION_TTL_HOURS`) and rotates `ll_csrf`. The server stores only the SHA-256 of
   the session token.
4. `POST /api/v1/auth/logout` deletes the session row.

Registration (`POST /api/v1/auth/register`) always answers `202` with the same message whether
or not the email is already registered and never signs the user in. Email verification through
the local outbox is LG-211.

### Ingestion API keys

Log shippers authenticate with `Authorization: Bearer llk_<prefix>_<secret>`. Keys are created
by an owner/admin (`ingest:keys:manage`); the plaintext is returned exactly once. The server
looks the key up by its 8-character prefix and compares SHA-256 digests with
`crypto.timingSafeEqual`. Revoked keys are rejected immediately.

### Roles

| Role   | Highlights                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| viewer | `search:read`                                                                                                   |
| member | + `search:save`, `ingest:keys:read`, `dashboards:manage`                                                        |
| admin  | + `ingest:keys:manage`, `audit:read`, `members:manage`, `alerts:manage`, `pipelines:manage`, `retention:manage` |
| owner  | + `org:manage`                                                                                                  |

## Rate limits and guard rails

| Area            | Limit                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Login (email)   | 5 attempts per 15 min window, then progressive lock 1 s, 2 s, 4 s … capped at 15 min, regardless of IP |
| Login (IP)      | 30 attempts per 15 min per normalised IP (IPv6 /64) → 15 min lock                                      |
| Login (fan-out) | 20 distinct emails per IP per 15 min                                                                   |
| Registration    | 5 per normalised IP per hour                                                                           |
| Ingest          | 5 MiB body, 5 000 events per request (configurable); per-key/per-tenant quotas are LG-112/LG-113       |
| Search          | 5 s statement timeout, 10 000 rows max, 90-day range, 4 000-char query, 10 000 stats buckets           |

Client IPs come from the socket unless `TRUST_PROXY` is configured (hop count or proxy CIDRs).
Limiter state is per process; run a single API instance until LG-216 moves it to PostgreSQL.

## Pagination

List endpoints return `meta.total` today. Planned (LG-139): keyset pagination with an opaque
`meta.nextCursor` encoding `(timestamp, id)` of the last row; the client passes `cursor=` and
the server adds `(timestamp, id) < (, )` to the compiled predicate, which keeps deep pages
as cheap as the first one (no `OFFSET`). Search results are bounded instead by `| head`, the
`limit` field (default 100) and `QUERY_MAX_ROWS`; `stats.truncated` tells the client when the
cap was hit.

## LensQL quick reference

| Construct       | Example                                                       | Meaning                                        |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Free text       | `timeout`, `"connection reset"`, `fail*`                      | Case-insensitive match on `message`            |
| Comparison      | `level=error`, `http.status>=500`, `service!=billing`         | Built-in columns or attribute paths            |
| Wildcard value  | `host=web-*`                                                  | Anchored, case-insensitive                     |
| Regex           | `message=~"time(d)?out"`, `host!~"^db"`                       | PostgreSQL regular expressions                 |
| IN list         | `http.status in (502, 503, 504)`                              | Up to 100 values                               |
| Existence       | `user_id=*`, `region!=*`                                      | Field present / absent                         |
| Boolean         | `(a OR b) NOT c`                                              | Adjacency = AND; AND binds tighter than OR     |
| Time bounds     | `earliest=-15m latest=now`                                    | Overrides the request range (top level only)   |
| `where`         | `… \| where latency_ms>1000`                                  | Extra filter                                   |
| `fields`        | `… \| fields service, http.path`                              | Projection                                     |
| `sort` / `head` | `… \| sort -latency_ms \| head 20`                            | Order and cap                                  |
| `stats`         | `… \| stats count() as n, p95(latency_ms) by service span=5m` | Aggregation; then `where/sort/head` on outputs |

Built-in fields: `timestamp` (`_time`), `level`, `service`, `host`, `source`, `message`
(`msg`), `trace_id`. Anything else is an attribute path (`http.status` or
`attributes.http.status`). Aggregates: `count`, `dc`, `sum`, `avg`, `min`, `max`, `p50`,
`p90`, `p95`, `p99`. Full grammar: [system-design.md](../design/system-design.md#1-lensql).

## curl examples (implemented endpoints)

Start the stack with `./run.sh setup && ./run.sh dev`. The demo seed creates
`owner@acme.test` / `loglens-demo-password` and the ingestion key below.

```bash
B=http://127.0.0.1:4109
JAR=$(mktemp)
KEY=llk_DemoKey1_ddddddddddddddddddddddddddddddddddddddddddd

# Health and readiness
curl -s $B/health
curl -s $B/ready

# CSRF token (sets ll_csrf in the jar)
CSRF=$(curl -s -c $JAR -b $JAR $B/api/v1/auth/csrf | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')

# Register (always 202 with a generic message)
curl -s -c $JAR -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"organizationName":"Globex","name":"Gil","email":"gil@globex.test","password":"a-long-passphrase"}' \
  $B/api/v1/auth/register

# Login (sets ll_session, rotates ll_csrf)
curl -s -c $JAR -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"email":"owner@acme.test","password":"loglens-demo-password"}' $B/api/v1/auth/login
CSRF=$(awk '/ll_csrf/ {print $7}' $JAR)

# Current user
curl -s -b $JAR $B/api/v1/auth/me

# API keys: list, create (token shown once), revoke
curl -s -b $JAR $B/api/v1/api-keys
curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"name":"prod shipper","defaultService":"checkout"}' $B/api/v1/api-keys
curl -s -b $JAR -H "x-csrf-token: $CSRF" -X DELETE $B/api/v1/api-keys/<key-id>

# Ingest NDJSON (no cookies or CSRF; bearer key only)
curl -s -H "Authorization: Bearer $KEY" -H 'content-type: application/x-ndjson' \
  --data-binary $'{"level":"error","service":"checkout","message":"upstream timeout","http":{"status":504},"latency_ms":3100}\n{"level":"info","service":"checkout","message":"ok"}' \
  $B/api/v1/ingest

# Ingest a JSON array
curl -s -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '[{"message":"one","level":"warn"},{"message":"two","ts":1773143940}]' $B/api/v1/ingest

# Search events
curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"query":"service=checkout http.status>=500","limit":20}' $B/api/v1/search

# Statistics over the last 24 hours
curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"query":"earliest=-24h level=error | stats count() as n by service | sort -n | head 5"}' $B/api/v1/search

# Histogram
curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"query":"level=error","from":"2026-11-24T00:00:00Z","to":"2026-11-25T00:00:00Z","buckets":48}' \
  $B/api/v1/search/histogram

# Validate without executing
curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"query":"service>api"}' $B/api/v1/search/validate

# A pending endpoint answers 501 with its ticket
curl -s -b $JAR $B/api/v1/dashboards

# Logout
curl -s -b $JAR -H "x-csrf-token: $CSRF" -X POST -H 'content-type: application/json' -d '{}' $B/api/v1/auth/logout
```
