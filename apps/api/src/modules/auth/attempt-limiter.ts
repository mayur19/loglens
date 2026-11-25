import { BoundedStore, type WarnLogger } from './bounded-store.js';

export interface LimitPolicy {
  /** Attempts allowed inside one window before a lock applies. */
  readonly threshold: number;
  readonly windowMs: number;
  readonly lockMs: number;
  /** When true the lock doubles for every attempt past the threshold (capped at maxLockMs). */
  readonly progressive: boolean;
  readonly maxLockMs: number;
}

interface CounterEntry {
  readonly count: number;
  readonly windowStart: number;
  readonly lockedUntil: number;
  readonly expiresAt: number;
}

export interface LimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

const ALLOWED: LimitDecision = { allowed: true, retryAfterMs: 0 };

/**
 * Counts attempts per key with optional progressive lockout. `check` and `record` are synchronous
 * so a caller can reserve an attempt before its first await, closing the race where parallel
 * requests all pass the check before any of them is counted.
 */
export class AttemptLimiter {
  private readonly store: BoundedStore<CounterEntry>;

  constructor(
    private readonly policy: LimitPolicy,
    maxEntries: number,
    logger: WarnLogger,
    label: string,
  ) {
    this.store = new BoundedStore<CounterEntry>(maxEntries, logger, label);
  }

  get size(): number {
    return this.store.size;
  }

  check(key: string, now: number): LimitDecision {
    const entry = this.store.get(key, now);
    if (entry && entry.lockedUntil > now)
      return { allowed: false, retryAfterMs: entry.lockedUntil - now };
    return ALLOWED;
  }

  private lockFor(count: number): number {
    const { threshold, lockMs, progressive, maxLockMs } = this.policy;
    if (count < threshold) return 0;
    if (!progressive) return lockMs;
    return Math.min(lockMs * 2 ** Math.min(count - threshold, 30), maxLockMs);
  }

  record(key: string, now: number): void {
    const current = this.store.get(key, now);
    const fresh = !current || now - current.windowStart >= this.policy.windowMs;
    const count = fresh ? 1 : current.count + 1;
    const windowStart = fresh ? now : current.windowStart;
    const lock = this.lockFor(count);
    const lockedUntil = lock > 0 ? now + lock : 0;
    const expiresAt = Math.max(lockedUntil, windowStart + this.policy.windowMs);
    this.store.set(key, { count, windowStart, lockedUntil, expiresAt }, now);
  }

  /** Gives back one reserved attempt (used when the attempt turned out to be legitimate). */
  release(key: string, now: number): void {
    const current = this.store.get(key, now);
    if (!current) return;
    const count = Math.max(0, current.count - 1);
    const lockedUntil = count < this.policy.threshold ? 0 : current.lockedUntil;
    this.store.set(
      key,
      {
        ...current,
        count,
        lockedUntil,
        expiresAt: Math.max(lockedUntil, current.windowStart + this.policy.windowMs),
      },
      now,
    );
  }

  reset(key: string): void {
    this.store.delete(key);
  }
}
