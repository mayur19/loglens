# ADR-0005: Forward-only plain-SQL migrations with checksums

- **Status:** Accepted
- **Date:** 2026-11-20
- **Related:** ADR-0004, LG-004

## Context

The schema uses features that ORMs model poorly: declarative partitioning, a `DEFAULT` partition, a PL/pgSQL partition-creation function, trigram GIN indexes and an append-only trigger on `audit_events`. Operators run migrations on their own servers, sometimes from two hosts at once during a deploy.

## Decision Drivers

- Full access to PostgreSQL DDL.
- Detect edited history (a migration changed after it was applied somewhere).
- Safe under concurrent runners.
- Atomic: a failing migration must leave no trace.

## Considered Options

1. **Plain `.sql` files + small in-repo runner** (`apps/api/src/db/migrate.ts`).
2. **ORM migrations (Prisma/TypeORM)** — tool-emitted DDL cannot express partitions/functions cleanly.
3. **Third-party tool (Flyway, dbmate, node-pg-migrate)** — capable, but an extra binary or dependency for ~80 lines of logic.

## Decision Outcome

Chosen option 1. Files are named `NNNN_snake_name.sql` and applied in lexical order. The runner takes `pg_advisory_lock(hashtext('loglens:migrate'))`, creates `schema_migrations(version, name, checksum, applied_at)`, verifies the SHA-256 of every applied file (raising `MigrationChecksumError` on mismatch), and runs each pending file in its own transaction together with its bookkeeping insert. There are no down migrations: fixes are new forward migrations.

## Consequences

- **Positive:** tested behaviour — idempotent rerun, checksum detection and rollback of a failing file (`apps/api/test/migrate.db.test.ts`).
- **Negative:** statements that cannot run inside a transaction (`CREATE INDEX CONCURRENTLY`) need a future opt-out marker; rollback of a bad release means restoring a backup or writing a corrective migration.
- Currently migrated: `0001_foundation`, `0002_ingestion_and_search`. The remaining target schema is documented in `docs/design/data-model.md`.
