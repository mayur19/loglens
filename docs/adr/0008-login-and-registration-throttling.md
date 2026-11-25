# ADR-0008: Login and registration throttling design

- **Status:** Accepted
- **Date:** 2026-11-24
- **Related:** ADR-0007, NFR-010, LG-013, LG-010, LG-216

## Context

Login and self-service registration are the only unauthenticated, state-changing endpoints for humans. Threats: online password guessing against one account from many IPs (credential stuffing), one IP trying a common password against many accounts (password spraying), concurrency races where many parallel requests pass the check before any is counted, address rotation inside an IPv6 allocation, attackers filling a bounded limiter store to evict real lockouts or to lock everyone out, and account enumeration through registration responses. Client IPs are only trustworthy if the proxy chain is configured explicitly.

## Decision Drivers

- Stop both stuffing and spraying without letting an attacker lock out arbitrary users cheaply.
- No race window between check and count.
- Bounded memory under attack, without denial of service for unrelated users.
- No account enumeration via registration.
- Correct client IP derivation behind reverse proxies, never guessed from `NODE_ENV`.

## Considered Options

1. **Single combined key `ip|email`** — trivially bypassed by rotating either part; does not detect spraying.
2. **Three independent in-process counters (email, IP, distinct-emails-per-IP) with synchronous reservation and a bounded store** — fast, precise, single-instance only.
3. **Counters in PostgreSQL from day one** — multi-instance safe, but adds a write per attempt and needs careful atomic upserts; deferred to LG-216.
4. **Third-party rate-limit plugin** — generic fixed-window limits, no progressive backoff, no fan-out cap, opaque eviction.

## Decision Outcome

Chosen option 2 (`apps/api/src/modules/auth/login-throttle.ts`, `attempt-limiter.ts`, `bounded-store.ts`, `ip.ts`):

| Counter      | Key               | Policy                                                                                        |
| ------------ | ----------------- | --------------------------------------------------------------------------------------------- |
| Per account  | lower-cased email | 5 attempts / 15 min window, then lock `1 s × 2^(n-5)`, capped at 15 min (progressive backoff) |
| Per source   | normalised IP     | 30 attempts / 15 min, then 15 min lock (spray detection)                                      |
| Fan-out      | normalised IP     | at most 20 distinct emails per 15 min window                                                  |
| Registration | normalised IP     | 5 / hour, then lock until window end                                                          |

- **Reservation before await:** `reserve()` checks all counters and, if allowed, records the attempt synchronously before the handler's first `await`. A success calls `succeed()`, which resets the email counter and refunds one IP attempt. Twelve parallel bad logins yield exactly five 401s and seven 429s (`auth.db.test.ts`).
- **IP normalisation:** IPv4-mapped IPv6 (`::ffff:a.b.c.d`, including hex form) becomes IPv4; other IPv6 addresses collapse to their `/64` network.
- **Bounded store:** each limiter holds at most 50,000 keys. When full, a resumable cursor (a live `Map` iterator kept between calls) sweeps forward, deleting expired entries, until space is found or the whole map has been visited once. If every entry is still active, the entry with the least time left is evicted and a warning is logged. New keys are never refused, so filling the store cannot lock out everyone; the fan-out cap bounds how many keys one IP can create.
- **Registration:** identical `202` body whether or not the email exists; the duplicate path still pays the scrypt cost and writes an `auth.register.duplicate` audit event. Users must sign in afterwards (no auto-login that would reveal success). Email verification via the local outbox is LG-211.
- **Trust proxy:** `TRUST_PROXY` is `false` (default), a hop count 1–10, or a list of proxy IPs/CIDRs (`apps/api/src/config/env.ts`). Production startup fails if it is unset.

## Consequences

- **Positive:** stuffing, spraying and parallel bursts are covered by unit and integration tests; memory is bounded.
- **Negative:** an attacker who knows a victim's email can delay that user's logins (bounded at 15 minutes per lock); accepted trade-off, mitigated later by MFA-aware unlocks.
- **Negative:** counters are per process. Running more than one API instance requires moving them to PostgreSQL (`login_attempts` table with atomic upserts, LG-216). This is called out in the threat model and runbook.
