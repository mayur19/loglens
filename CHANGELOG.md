# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet. See [docs/planning/roadmap.md](docs/planning/roadmap.md) for milestone M3 (ingestion at scale).

## [0.1.0] - 2026-11-25

First release: foundation plus the LensQL search slice (milestones M0–M2).

### Added

- npm-workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`) with strict TypeScript, ESLint, Prettier and `run.sh`.
- Zod-validated configuration that fails fast. `TRUST_PROXY` accepts `false`, a hop count or a list of proxy CIDRs and is required in production.
- Fastify 5 API with a JSON envelope, central error handler, request IDs and redacted structured logs.
- Forward-only SQL migration runner with checksums, per-file transactions and an advisory lock.
- Migrations `0001_foundation` (organizations, users, memberships, sessions, append-only audit trail) and `0002_ingestion_and_search` (API keys, daily range-partitioned `log_events` with default partition, trigram and jsonb GIN indexes, `loglens_ensure_daily_partitions`).
- Registration that does not reveal existing emails and is limited per IP. Session login/logout/me with hashed tokens. CSRF double submit. RBAC permissions.
- Login throttling: per-email progressive backoff, per-IP spray limiter, cap on distinct emails per IP, synchronous reservation, IPv6 /64 normalisation, bounded in-memory store with resumable sweep.
- Ingestion API keys: SHA-256 at rest, prefix lookup, constant-time comparison, revocation.
- `POST /api/v1/ingest` for NDJSON and JSON with level/timestamp normalisation, clock-skew clamping, size limits and per-line rejection reports.
- LensQL lexer, parser, semantic analyzer and compiler to parameterised SQL: free text, comparisons, wildcards, regex, IN, existence, AND/OR/NOT, `earliest`/`latest`, `where`, `fields`, `sort`, `head`, and `stats` with count/dc/sum/avg/min/max/p50/p90/p95/p99, `by` and `span`.
- `POST /api/v1/search`, `/search/histogram` and `/search/validate`, run in read-only transactions with a statement timeout.
- Web app: login/register, app shell with Planned sections, Search screen (SVG histogram, results table, error underline) and Ingestion keys screen.
- Deterministic demo seed (20 000 events, incident spike).
- 501 stubs for every planned endpoint, each carrying its backlog ticket.
- CI on GitHub Actions using the runner's native PostgreSQL. 401 tests.
- Full documentation set: PRD, requirements, ADRs, design, OpenAPI, threat model, runbook, roadmap and backlog.

[Unreleased]: https://github.com/mayur19/loglens/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mayur19/loglens/releases/tag/v0.1.0
