# ADR-0019: Local outbox instead of external notification providers

- **Status:** Proposed
- **Date:** 2026-11-24
- **Related:** ADR-0017, LG-170..LG-173, LG-201, LG-210, LG-211

## Context

Alerts, invitations, password resets and signup verification all need to "send" something. The product must not call third-party email/SMS/chat providers. Delivery must be reliable even if the process crashes between deciding to notify and delivering.

## Decision Drivers

- No third-party providers.
- Atomicity between state change (alert fired, invitation created) and the notification record.
- Retries with backoff and an inspectable history.
- Operators can wire delivery to their own infrastructure (local SMTP relay, internal webhook receiver).

## Considered Options

1. **Transactional outbox table + local delivery worker.**
2. **Send directly from request handlers** — loses messages on crash, couples latency to remote endpoints.
3. **External queue** — extra infrastructure.

## Decision Outcome

Chosen option 1 (M7/M8). `outbox_messages(id, organization_id, channel, kind, payload jsonb, status pending|delivering|delivered|failed, attempts, next_attempt_at, last_error, created_at)` is written in the same transaction as the triggering change. A worker claims rows with `FOR UPDATE SKIP LOCKED`, delivers them through channel adapters — `in_app` (inserts into `notifications`), `webhook` (HTTP POST to an operator-configured URL on the local network, HMAC-signed body), `email` (writes an `.eml` file to a spool directory or hands to a local SMTP relay configured by the operator) — and retries with exponential backoff (1 min doubling, max 6 attempts) before marking `failed`. `GET /api/v1/outbox` (pending, LG-171) lets admins inspect delivery.

## Consequences

- **Positive:** no lost notifications; full audit of what was sent; works offline.
- **Negative:** webhook targets are operator responsibility; SSRF protections (allow-listed hosts, no redirects to link-local addresses) must be part of LG-170.
