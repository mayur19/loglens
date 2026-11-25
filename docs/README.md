# LogLens Documentation

Start with the [PRD](product/PRD.md) for the why, the [architecture overview](architecture/overview.md) for the how, and [implementation status](planning/implementation-status.md) for what exists today (10.9 %).

## Product

- [PRD](product/PRD.md): vision, personas, goals and non-goals, scope, metrics, release plan
- [Requirements](product/requirements.md): FR-001 … FR-072 and NFR-001 … NFR-020 with MoSCoW priority and acceptance criteria
- [User stories](product/user-stories.md): epics and stories in Given/When/Then form
- [Requirements traceability](product/requirements-traceability.md): FR → epic → ticket → module → test → status

## Architecture

- [Overview](architecture/overview.md): C4 context, container and component diagrams, module boundaries, request lifecycle
- [Quality attributes](architecture/quality-attributes.md): measurable NFR targets and how each is verified
- [Architecture decision records](adr/README.md): ADR-0001 … ADR-0019

## Design

- [System design](design/system-design.md): LensQL pipeline, compiler algorithms and complexity, ingestion flow, state machines, concurrency
- [Data model](design/data-model.md): full target ERD, table notes, indexes, migrated vs planned

## API

- [API guide](api/README.md): conventions, auth, errors, pagination, curl examples
- [OpenAPI 3.1 specification](api/openapi.yaml): the full target API, with `x-status: implemented | pending` on each operation

## Security

- [Threat model](security/threat-model.md): trust boundaries, STRIDE per component, OWASP ASVS mapping

## Testing

- [Test strategy](testing/test-strategy.md): pyramid, suites, real-PostgreSQL integration, coverage, acceptance matrix

## Operations

- [Runbook](operations/runbook.md): configuration, migrations, backup and restore, partition maintenance, troubleshooting
- [Deployment](operations/deployment.md): systemd, nginx, native PostgreSQL, release and rollback

## Planning

- [Roadmap](planning/roadmap.md): milestones M0–M8 with exit criteria
- [Backlog](planning/backlog.md) ([JSON](planning/backlog.json)): every ticket with estimate, status and dependencies
- [Implementation status](planning/implementation-status.md): what is done, what is stubbed, and how the percentage is computed
- [Risks](planning/risks.md): risk register

## Reference

- [Glossary](glossary.md)
