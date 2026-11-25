# ADR-0017: Alert evaluation with a leased scheduler, state machine, EWMA and hysteresis

- **Status:** Proposed
- **Date:** 2026-11-24
- **Related:** ADR-0011, ADR-0013, ADR-0019, LG-160..LG-167, NFR-018

## Context

Alert rules run a LensQL query on a schedule (e.g. every minute over the last 5 minutes) and fire when a threshold is crossed or when the value is anomalous relative to recent history. Correctness pitfalls: double evaluation when several API processes run, missed evaluations after downtime, duplicate notifications for one ongoing problem, and alert storms from a value oscillating around its threshold (flapping).

## Decision Drivers

- Exactly-one evaluator per rule per tick across processes, without an external coordinator.
- Deterministic, testable evaluation with an injectable clock (LG-167).
- One notification per incident episode (deduplication).
- Suppress flapping without hiding sustained problems.
- Fire within two evaluation intervals (NFR-018).

## Considered Options

1. **PostgreSQL-leased scheduler (`FOR UPDATE SKIP LOCKED`) + explicit state machine + EWMA baselines + hysteresis.**
2. **In-process `setInterval` per rule** — simple, but duplicates work with multiple processes and loses schedules on restart.
3. **External job queue (Redis/BullMQ)** — robust, but an extra server, contrary to ADR-0004.
4. **Cron via systemd timers per rule** — operationally clumsy and not tenant-aware.

## Decision Outcome

Chosen option 1 (to be implemented in M7):

**Scheduling.** `alert_rule_state(rule_id, next_run_at, lease_owner, lease_until, ...)`. Each worker loop runs:

```sql
SELECT rule_id FROM alert_rule_state
 WHERE next_run_at <= now() AND (lease_until IS NULL OR lease_until < now())
 ORDER BY next_run_at
 LIMIT 20
 FOR UPDATE SKIP LOCKED;
```

then sets `lease_owner`, `lease_until = now() + interval '30 s'` and commits. After evaluation it advances `next_run_at = next_run_at + interval` (catching up at most N missed ticks, then skipping to now to avoid storms) and clears the lease. A crashed worker's lease expires and another worker picks the rule up. Evaluations reuse the search guard rails (read-only transaction, timeout) with the window `[t - window, t)` aligned to the tick, so results are reproducible for backtesting (LG-162).

**State machine** per rule and dedup key (rule id + group-by values):

```
OK --breach--> PENDING --breach for `for` duration--> FIRING
PENDING --clear--> OK
FIRING --clear for `resolve_after` evaluations--> RESOLVED --> OK
FIRING --acknowledge--> FIRING(acked)   (no repeat notifications)
any --silence window--> evaluation continues, notifications suppressed
```

Transitions append to `alert_events`; notifications are emitted only on `PENDING→FIRING` and `FIRING→RESOLVED` (and optional re-notify intervals), keyed by the dedup key so an ongoing problem produces one incident.

**Anomaly detection (EWMA).** For each series value `x_t`: `μ_t = α·x_t + (1−α)·μ_{t−1}`, `σ²_t = α·(x_t − μ_{t−1})² + (1−α)·σ²_{t−1}`, with `α = 2/(N+1)` for a configurable span N (default 30 ticks). A breach occurs when `|x_t − μ_{t−1}| > k·σ_{t−1}` (default k = 3) after a warm-up of N samples. Baselines are updated only with non-anomalous points so an incident does not teach the model that errors are normal. State (μ, σ², sample count) persists in `alert_rule_state`, making evaluation O(1) per tick.

**Hysteresis.** A rule with threshold T fires when the value crosses T and resolves only when it crosses back past `T − h` (or `T + h` for "below" rules), where h defaults to 10% of T; additionally a rule that changed state more than F times (default 4) in the last W evaluations (default 10) is marked flapping and holds FIRING until it is stable for W evaluations.

## Consequences

- **Positive:** horizontal workers without extra infrastructure; deterministic replay with a simulated clock.
- **Negative:** evaluation load is on the primary database; heavy rule sets need the result cache (LG-138) and per-tenant limits.
- **Negative:** EWMA assumes roughly stationary series; strong daily seasonality may need seasonal baselines in a later ADR.
