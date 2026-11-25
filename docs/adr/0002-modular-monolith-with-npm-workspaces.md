# ADR-0002: Modular monolith with npm workspaces

- **Status:** Accepted
- **Date:** 2026-11-20
- **Related:** ADR-0003, LG-001

## Context

LogLens has three deployable or reusable parts: an HTTP API, a single-page web app, and domain logic that both need (LensQL parser/compiler, event normalisation, zod schemas, role tables). The web app uses the LensQL time presets and schemas; the API uses the compiler. Small and medium teams self-host the product, so operational simplicity matters more than independent scaling of components.

## Decision Drivers

- One process to deploy and operate (systemd unit) for the target audience.
- Hard algorithms must live in pure, framework-free code that is trivially unit tested.
- Type sharing between API and UI without publishing packages.
- Ability to split ingestion into its own process later without rewriting modules.

## Considered Options

1. **Modular monolith in npm workspaces** (`apps/api`, `apps/web`, `packages/shared`) — one repo, one lockfile, shared types; module boundaries enforced by folder structure (`apps/api/src/modules/<domain>`).
2. **Microservices (ingest, query, alerting, auth)** — independent scaling, but needs service discovery, inter-service auth and distributed tracing; far too heavy for a self-hosted single-node product.
3. **Single package with everything** — simplest tooling, but domain logic would be entangled with Fastify and React imports.

## Decision Outcome

Chosen option 1. `packages/shared` contains only pure TypeScript (no Node or DOM APIs besides `TextEncoder`), shipped as source and bundled into the API by tsup (`noExternal: ['@loglens/shared']`) and into the web app by Vite. Each API module (`auth`, `api-keys`, `ingest`, `search`, `audit`, `health`, `pending`) owns its routes, service and repository files and talks to others only through exported functions.

## Consequences

- **Positive:** the LensQL engine has 228 isolated unit tests with ~99.7% coverage; one `npm ci` sets up everything; CI runs lint/typecheck/test/build once for the whole tree.
- **Positive:** ingestion can later run as a second process using the same code (`buildApp` with only the ingest module registered) when LG-100 lands.
- **Negative:** a single release cadence for all parts; workspace boundaries are conventions, not enforced by the compiler (an ESLint import rule may be added later).
