# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** LogLens core team

## Context

LogLens combines several subsystems with non-obvious trade-offs: an in-house query language, a partitioned event store in PostgreSQL, an ingestion path authenticated by API keys, and (planned) a scheduled alert evaluator. Decisions such as "why are LensQL identifiers never interpolated into SQL" or "why does `NOT` include events where the field is missing" are easy to undo accidentally if the reasoning is not written down next to the code.

## Decision Drivers

- New contributors must be able to understand why the code looks the way it does without archaeology in commit history.
- Security-relevant decisions (query compilation, throttling, key storage) need an auditable rationale.
- Decisions must be reviewable in the same pull request as the code they justify.

## Considered Options

1. **Markdown ADRs in `docs/adr/` (MADR template)** — versioned with the code, reviewable, greppable. Requires discipline to keep the status current.
2. **Wiki pages** — easy to edit, but drift from the code and are not reviewed with changes.
3. **No formal record; rely on code comments** — zero overhead, but comments explain _what_, rarely the rejected alternatives.

## Decision Outcome

Chosen option 1. Every significant decision is recorded as `docs/adr/NNNN-kebab-title.md` using MADR sections: Status, Context, Decision Drivers, Considered Options, Decision Outcome, Consequences. ADRs are immutable once Accepted; a change of direction is a new ADR that marks the old one `Superseded by ADR-XXXX`. Decisions for pending features are recorded as `Proposed` and promoted when the implementing ticket lands.

## Consequences

- **Positive:** reviewers can reject code that contradicts an Accepted ADR; the index in [README.md](README.md) doubles as an architecture tour.
- **Negative:** small writing overhead per decision; Proposed ADRs (0017–0019) can go stale if their tickets slip and must be revisited at milestone planning.
