import { AttemptLimiter, type LimitDecision, type LimitPolicy } from './attempt-limiter.js';
import { BoundedStore, type WarnLogger } from './bounded-store.js';
import { normalizeIp } from './ip.js';

const MINUTE = 60_000;

export const EMAIL_POLICY: LimitPolicy = {
  threshold: 5,
  windowMs: 15 * MINUTE,
  lockMs: 1000,
  progressive: true,
  maxLockMs: 15 * MINUTE,
};
export const IP_POLICY: LimitPolicy = {
  threshold: 30,
  windowMs: 15 * MINUTE,
  lockMs: 15 * MINUTE,
  progressive: false,
  maxLockMs: 15 * MINUTE,
};
export const REGISTER_POLICY: LimitPolicy = {
  threshold: 5,
  windowMs: 60 * MINUTE,
  lockMs: 60 * MINUTE,
  progressive: false,
  maxLockMs: 60 * MINUTE,
};
export const MAX_EMAILS_PER_IP = 20;
export const DEFAULT_MAX_ENTRIES = 50_000;

interface EmailFanout {
  readonly emails: ReadonlySet<string>;
  readonly windowStart: number;
  readonly expiresAt: number;
}

export interface LoginTicket {
  readonly ipKey: string;
  readonly emailKey: string;
}

export type Reservation =
  ({ readonly ok: true } & LoginTicket) | { readonly ok: false; readonly retryAfterMs: number };

export interface ThrottleOptions {
  readonly maxEntries?: number;
  readonly emailPolicy?: LimitPolicy;
  readonly ipPolicy?: LimitPolicy;
  readonly maxEmailsPerIp?: number;
}

/**
 * Login brute-force protection with three independent counters:
 *  - per email (progressive backoff) – stops guessing one account from many IPs;
 *  - per normalised IP (fixed lock)   – stops password spraying across many accounts;
 *  - distinct emails per IP per window – bounds how many email keys one source can create.
 * State is in-process; it must move to Postgres before running more than one API instance (LG-216).
 */
export class LoginThrottle {
  private readonly byEmail: AttemptLimiter;
  private readonly byIp: AttemptLimiter;
  private readonly fanout: BoundedStore<EmailFanout>;
  private readonly windowMs: number;
  private readonly maxEmailsPerIp: number;

  constructor(logger: WarnLogger, options: ThrottleOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const ipPolicy = options.ipPolicy ?? IP_POLICY;
    this.byEmail = new AttemptLimiter(
      options.emailPolicy ?? EMAIL_POLICY,
      max,
      logger,
      'login:email',
    );
    this.byIp = new AttemptLimiter(ipPolicy, max, logger, 'login:ip');
    this.fanout = new BoundedStore<EmailFanout>(max, logger, 'login:fanout');
    this.windowMs = ipPolicy.windowMs;
    this.maxEmailsPerIp = options.maxEmailsPerIp ?? MAX_EMAILS_PER_IP;
  }

  /** Synchronously checks every limiter and, if allowed, counts the attempt immediately. */
  reserve(rawIp: string | undefined, email: string, now: number): Reservation {
    const ipKey = normalizeIp(rawIp);
    const emailKey = email.trim().toLowerCase();
    const decisions: LimitDecision[] = [
      this.byIp.check(ipKey, now),
      this.byEmail.check(emailKey, now),
    ];
    const fan = this.fanout.get(ipKey, now);
    const activeFan = fan && now - fan.windowStart < this.windowMs ? fan : null;
    if (
      activeFan &&
      !activeFan.emails.has(emailKey) &&
      activeFan.emails.size >= this.maxEmailsPerIp
    ) {
      decisions.push({ allowed: false, retryAfterMs: activeFan.windowStart + this.windowMs - now });
    }
    const blocked = decisions.filter((d) => !d.allowed);
    if (blocked.length > 0) {
      return { ok: false, retryAfterMs: Math.max(...blocked.map((d) => d.retryAfterMs)) };
    }
    this.byIp.record(ipKey, now);
    this.byEmail.record(emailKey, now);
    const windowStart = activeFan?.windowStart ?? now;
    const emails = new Set([...(activeFan?.emails ?? []), emailKey]);
    this.fanout.set(ipKey, { emails, windowStart, expiresAt: windowStart + this.windowMs }, now);
    return { ok: true, ipKey, emailKey };
  }

  /** A successful login clears the account's failures and refunds the IP's reserved attempt. */
  succeed(ticket: LoginTicket, now: number): void {
    this.byEmail.reset(ticket.emailKey);
    this.byIp.release(ticket.ipKey, now);
  }
}

/** Per-IP limiter for self-service registration. */
export class RegisterThrottle {
  private readonly limiter: AttemptLimiter;

  constructor(
    logger: WarnLogger,
    policy: LimitPolicy = REGISTER_POLICY,
    maxEntries = DEFAULT_MAX_ENTRIES,
  ) {
    this.limiter = new AttemptLimiter(policy, maxEntries, logger, 'register:ip');
  }

  reserve(rawIp: string | undefined, now: number): LimitDecision {
    const key = normalizeIp(rawIp);
    const decision = this.limiter.check(key, now);
    if (decision.allowed) this.limiter.record(key, now);
    return decision;
  }
}
