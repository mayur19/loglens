# Contributing to LogLens

Thanks for helping. This guide covers how to set up, how changes are expected to look, and what has to pass before a change can merge.

## Setup

```bash
./run.sh setup     # Node 22+, native PostgreSQL 15+ (socket in /tmp by default)
./run.sh dev
```

Containers are not used anywhere in this project, in development or in CI. Please keep it that way.

## Picking work

Every piece of work maps to a ticket in [docs/planning/backlog.md](docs/planning/backlog.md) (`LG-###`). Larger tickets have GitHub issues. Pending endpoints already exist as 501 stubs in `apps/api/src/modules/pending/pending.routes.ts`. Implementing one means removing it from `PENDING_ROUTES`, registering the real route, flipping `x-status` to `implemented` in `docs/api/openapi.yaml`, and updating the backlog status and [implementation-status.md](docs/planning/implementation-status.md).

## Workflow

1. Branch from `main`: `feat/lg-130-saved-searches`.
2. Write the tests first. They should fail before your change and pass after it.
3. Keep commits focused and use [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`, `ci:`. Reference the ticket in the body (`Refs LG-130`).
4. Before pushing, run `./run.sh test`. This runs lint, format check, typecheck and every test against `TEST_DATABASE_URL`.
5. Open a pull request describing behaviour, risks and the test plan.

## Required checks

- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test:coverage` and `npm run build` all green.
- Coverage thresholds: `packages/shared` 90 % lines, `apps/api` 80 % lines. They apply to implemented code.
- New database behaviour needs an integration test against real PostgreSQL in `apps/api/test/*.db.test.ts`. Do not mock the database for SQL you write.
- Any change to the LensQL grammar or compiler must extend `packages/shared/test/lensql/injection.test.ts` with payloads in the new syntactic positions.

## Code style

- TypeScript strict mode, with `noUncheckedIndexedAccess` on.
- Prefer immutable data. Domain functions return new objects and do not mutate their inputs.
- Small units: files under 400 lines, functions under 50 lines, nesting no deeper than 4 levels.
- Validate every external input with zod at the boundary (`packages/shared/src/schemas`).
- SQL is plain, parameterised and lives in `*.repo.ts` files or the LensQL compiler. Never build SQL from user text.
- Every query on tenant data filters by `organization_id` taken from the session or API key.
- Errors: throw `AppError` for expected failures. Never return stack traces to clients. Never log secrets.
- No new runtime dependency without a short justification in an ADR.

## Migrations

Add `apps/api/migrations/NNNN_description.sql`. Migrations are forward-only and must not be edited after they are merged, because the runner checks checksums. Keep changes additive for one release so rollbacks stay safe ([deployment.md](docs/operations/deployment.md)).

## Documentation

Update the relevant docs in the same pull request: OpenAPI, requirements traceability, data model, and an ADR for any significant decision.
