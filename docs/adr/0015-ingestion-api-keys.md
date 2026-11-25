# ADR-0015: Ingestion API keys: prefix lookup, SHA-256 at rest, constant-time comparison

- **Status:** Accepted
- **Date:** 2026-11-22
- **Related:** ADR-0007, NFR-009, LG-026, LG-113, LG-114

## Context

Log shippers (Vector, Fluent Bit, cron scripts, in-house collectors) authenticate machine-to-machine with long-lived secrets. Keys must be revocable, attributable to a tenant, cheap to verify on every batch, and safe if the database leaks. Verification must not leak information through timing.

## Decision Drivers

- O(1) indexed lookup without storing secrets.
- No usable secrets in database dumps or logs.
- No timing oracle distinguishing unknown prefixes from wrong secrets.
- Human-recognisable keys for support ("which key is this?").

## Considered Options

1. **`llk_<8-char prefix>_<43-char secret>`; store prefix in clear and SHA-256 of the whole token; compare digests with `timingSafeEqual`.**
2. **Store scrypt/bcrypt hash of the key** — slow by design; unnecessary for 256-bit random secrets and too expensive per batch.
3. **Store the key encrypted** — reversible; a leaked encryption key exposes every secret.
4. **Signed tokens (HMAC/JWT)** — stateless, but revocation needs a lookup anyway.

## Decision Outcome

Chosen option 1 (`apps/api/src/modules/api-keys/`, `packages/shared/src/ingest/api-key.ts`). Keys contain 32 random bytes (256 bits) of secret, so a fast hash is sufficient: brute force is infeasible. `authenticateApiKey` always hashes the presented token and compares against either the stored digest or a fixed dummy digest when the prefix is unknown, so both paths do the same work. Revoked keys fail with the same 401 body. The plaintext token is returned exactly once in the `POST /api/v1/api-keys` response; listings show only the prefix. `last_used_at` is updated at most once per minute to avoid write amplification. Creation and revocation are audited.

## Consequences

- **Positive:** a database dump reveals only prefixes and SHA-256 digests; tests assert the token never appears in stored rows.
- **Negative:** a lost key cannot be recovered, only replaced. Scopes and expiry (LG-114) and per-key rate limiting (LG-113) are pending.
