# ADR-0007: Session authentication with scrypt, hashed session tokens and CSRF double submit

- **Status:** Accepted
- **Date:** 2026-11-21
- **Related:** ADR-0008, NFR-009, LG-010, LG-011, LG-012

## Context

Human users authenticate to the web app; machines authenticate to ingestion with API keys (ADR-0015). No external identity provider may be used. The SPA is served from the same origin as the API (Vite proxy in development, nginx in production).

## Decision Drivers

- No third-party auth services; standard library crypto only.
- Revocable sessions (logout, future session management LG-213).
- A database leak must not yield usable credentials or session tokens.
- CSRF protection for cookie-authenticated mutations.

## Considered Options

1. **Opaque random session token in an HttpOnly cookie; SHA-256 of the token stored in `sessions`; scrypt password hashes; CSRF double-submit cookie.**
2. **JWT access + refresh tokens** — stateless, but revocation needs a denylist anyway, tokens leak via XSS if stored in JS-readable storage, and key rotation adds complexity.
3. **bcrypt/argon2 via native modules** — fine algorithms, but native builds complicate installs; scrypt is in `node:crypto`.

## Decision Outcome

Chosen option 1, implemented in `apps/api/src/modules/auth/`:

- Passwords: scrypt N=16384, r=8, p=1, 64-byte key, 16-byte random salt, encoded `scrypt$N$r$p$salt$hash` so parameters can be raised later. Verification uses `timingSafeEqual`. Unknown users are verified against a cached dummy hash so response time does not reveal account existence.
- Sessions: 32 random bytes (base64url) in cookie `ll_session` (HttpOnly, SameSite=Lax, Secure in production, expiry `SESSION_TTL_HOURS`); only `sha256(token)` is stored. Lookups join session, user, organization and membership so a removed membership invalidates access immediately.
- CSRF: cookie `ll_csrf` (readable by the SPA) must equal header `x-csrf-token` on every non-GET `/api/*` request, compared in constant time (`registerCsrf`). Bearer-authenticated `/api/v1/ingest*` is exempt because browsers do not attach bearer tokens ambiently.

## Consequences

- **Positive:** logout deletes the row; stolen database dumps contain no usable tokens.
- **Positive:** login itself is CSRF-protected (prevents login CSRF), because the SPA first calls `GET /api/v1/auth/csrf`.
- **Negative:** each authenticated request costs one indexed query; `touchSession` throttles `last_seen_at` writes to once a minute.
- **Negative:** MFA (LG-212), password reset (LG-210) and email verification (LG-211) are pending.
