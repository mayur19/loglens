import { describe, expect, it, vi } from 'vitest';
import { AttemptLimiter } from '../src/modules/auth/attempt-limiter.js';
import { BoundedStore } from '../src/modules/auth/bounded-store.js';
import {
  EMAIL_POLICY,
  LoginThrottle,
  RegisterThrottle,
} from '../src/modules/auth/login-throttle.js';

const logger = () => ({ warn: vi.fn() });
const MIN = 60_000;

describe('AttemptLimiter', () => {
  it('applies progressive backoff once the threshold is reached', () => {
    const limiter = new AttemptLimiter(EMAIL_POLICY, 100, logger(), 't');
    let now = 0;
    for (let i = 0; i < 4; i += 1) limiter.record('k', now);
    expect(limiter.check('k', now).allowed).toBe(true);
    limiter.record('k', now); // 5th → 1s lock
    expect(limiter.check('k', now)).toEqual({ allowed: false, retryAfterMs: 1000 });
    now += 1000;
    limiter.record('k', now); // 6th → 2s
    expect(limiter.check('k', now).retryAfterMs).toBe(2000);
    now += 2000;
    limiter.record('k', now); // 7th → 4s
    expect(limiter.check('k', now).retryAfterMs).toBe(4000);
  });

  it('caps the backoff at maxLockMs', () => {
    const limiter = new AttemptLimiter(EMAIL_POLICY, 100, logger(), 't');
    for (let i = 0; i < 40; i += 1) limiter.record('k', 0);
    expect(limiter.check('k', 0).retryAfterMs).toBe(EMAIL_POLICY.maxLockMs);
  });

  it('starts a new window after windowMs', () => {
    const limiter = new AttemptLimiter(EMAIL_POLICY, 100, logger(), 't');
    for (let i = 0; i < 4; i += 1) limiter.record('k', 0);
    limiter.record('k', EMAIL_POLICY.windowMs);
    expect(limiter.check('k', EMAIL_POLICY.windowMs).allowed).toBe(true);
  });

  it('release refunds one attempt and lifts a lock below threshold; reset clears', () => {
    const limiter = new AttemptLimiter(
      { threshold: 2, windowMs: MIN, lockMs: MIN, progressive: false, maxLockMs: MIN },
      10,
      logger(),
      't',
    );
    limiter.record('k', 0);
    limiter.record('k', 0);
    expect(limiter.check('k', 0).allowed).toBe(false);
    limiter.release('k', 0);
    expect(limiter.check('k', 0).allowed).toBe(true);
    limiter.release('missing', 0);
    limiter.reset('k');
    expect(limiter.size).toBe(0);
  });
});

describe('BoundedStore', () => {
  it('rejects a non-positive capacity', () => {
    expect(() => new BoundedStore(0, logger(), 'x')).toThrow();
  });

  it('expires entries lazily on read', () => {
    const store = new BoundedStore<{ expiresAt: number }>(5, logger(), 'x');
    store.set('a', { expiresAt: 10 }, 0);
    expect(store.get('a', 5)).toBeDefined();
    expect(store.get('a', 10)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('sweeps expired entries before evicting active ones', () => {
    const log = logger();
    const store = new BoundedStore<{ expiresAt: number }>(3, log, 'x');
    store.set('a', { expiresAt: 100 }, 0);
    store.set('b', { expiresAt: 5 }, 0);
    store.set('c', { expiresAt: 100 }, 0);
    store.set('d', { expiresAt: 100 }, 10);
    expect(store.get('b', 10)).toBeUndefined();
    expect(store.get('a', 10)).toBeDefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('resumes the sweep cursor so later sweeps reach entries past the oldest', () => {
    const store = new BoundedStore<{ expiresAt: number }>(4, logger(), 'x');
    store.set('a', { expiresAt: 1000 }, 0);
    store.set('b', { expiresAt: 1000 }, 0);
    store.set('c', { expiresAt: 20 }, 0);
    store.set('d', { expiresAt: 30 }, 0);
    store.set('e', { expiresAt: 1000 }, 25); // sweeps a,b (active), finds c expired
    expect(store.get('c', 25)).toBeUndefined();
    store.set('f', { expiresAt: 1000 }, 35); // cursor resumes at d (expired) without rescanning a,b
    expect(store.get('d', 35)).toBeUndefined();
    expect(['a', 'b', 'e', 'f'].every((k) => store.get(k, 35))).toBe(true);
  });

  it('when full of active entries, evicts the one with the least time left and warns', () => {
    const log = logger();
    const store = new BoundedStore<{ expiresAt: number }>(3, log, 'login:email');
    store.set('long', { expiresAt: 900 }, 0);
    store.set('short', { expiresAt: 200 }, 0);
    store.set('mid', { expiresAt: 500 }, 0);
    store.set('new', { expiresAt: 1000 }, 100);
    expect(store.get('short', 100)).toBeUndefined();
    expect(store.get('new', 100)).toBeDefined();
    expect(store.size).toBe(3);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ store: 'login:email', remainingMs: 100 }),
      expect.stringContaining('evicted'),
    );
  });

  it('updating an existing key never triggers eviction', () => {
    const log = logger();
    const store = new BoundedStore<{ expiresAt: number }>(1, log, 'x');
    store.set('a', { expiresAt: 100 }, 0);
    store.set('a', { expiresAt: 200 }, 0);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('LoginThrottle', () => {
  it('locks an email regardless of source IP (credential stuffing across IPs)', () => {
    const throttle = new LoginThrottle(logger());
    for (let i = 0; i < 5; i += 1)
      expect(throttle.reserve(`198.51.100.${i}`, 'victim@acme.test', 0).ok).toBe(true);
    const blocked = throttle.reserve('203.0.113.99', 'VICTIM@acme.test', 0);
    expect(blocked).toEqual({ ok: false, retryAfterMs: 1000 });
  });

  it('locks an IP that sprays many accounts', () => {
    const throttle = new LoginThrottle(logger(), { maxEmailsPerIp: 1000 });
    for (let i = 0; i < 30; i += 1)
      expect(throttle.reserve('203.0.113.5', `user${i}@acme.test`, 0).ok).toBe(true);
    const blocked = throttle.reserve('203.0.113.5', 'fresh@acme.test', 0);
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.retryAfterMs).toBe(15 * MIN);
    expect(throttle.reserve('203.0.113.6', 'fresh@acme.test', 0).ok).toBe(true);
  });

  it('caps distinct email keys per IP per window', () => {
    const throttle = new LoginThrottle(logger(), { maxEmailsPerIp: 3 });
    for (const e of ['a', 'b', 'c'])
      expect(throttle.reserve('203.0.113.5', `${e}@x.test`, 0).ok).toBe(true);
    expect(throttle.reserve('203.0.113.5', 'd@x.test', 1000)).toEqual({
      ok: false,
      retryAfterMs: 15 * MIN - 1000,
    });
    expect(throttle.reserve('203.0.113.5', 'a@x.test', 1000).ok).toBe(true);
    expect(throttle.reserve('203.0.113.5', 'd@x.test', 15 * MIN).ok).toBe(true);
  });

  it('treats addresses in one IPv6 /64 and IPv4-mapped forms as the same source', () => {
    const throttle = new LoginThrottle(logger(), { maxEmailsPerIp: 2 });
    expect(throttle.reserve('2001:db8:1:2::1', 'a@x.test', 0).ok).toBe(true);
    expect(throttle.reserve('2001:db8:1:2::ffff', 'b@x.test', 0).ok).toBe(true);
    expect(throttle.reserve('2001:db8:1:2:aaaa::3', 'c@x.test', 0).ok).toBe(false);
    expect(throttle.reserve('::ffff:192.0.2.1', 'a@x.test', 0).ok).toBe(true);
    expect(throttle.reserve('192.0.2.1', 'b@x.test', 0).ok).toBe(true);
    expect(throttle.reserve('192.0.2.1', 'c@x.test', 0).ok).toBe(false);
  });

  it('reserves synchronously: parallel attempts beyond the threshold are refused', () => {
    const throttle = new LoginThrottle(logger());
    const results = Array.from({ length: 12 }, () => throttle.reserve('192.0.2.1', 'x@x.test', 0));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it('success resets the email counter and refunds the IP attempt', () => {
    const throttle = new LoginThrottle(logger());
    for (let i = 0; i < 4; i += 1) throttle.reserve('192.0.2.1', 'x@x.test', 0);
    const ticket = throttle.reserve('192.0.2.1', 'x@x.test', 0);
    expect(ticket.ok).toBe(true);
    if (ticket.ok) throttle.succeed(ticket, 0);
    expect(throttle.reserve('192.0.2.1', 'x@x.test', 0).ok).toBe(true);
  });
});

describe('RegisterThrottle', () => {
  it('limits registrations per normalised IP', () => {
    const throttle = new RegisterThrottle(logger());
    for (let i = 0; i < 5; i += 1)
      expect(throttle.reserve('::ffff:192.0.2.9', 0).allowed).toBe(true);
    expect(throttle.reserve('192.0.2.9', 0).allowed).toBe(false);
    expect(throttle.reserve('192.0.2.10', 0).allowed).toBe(true);
  });
});
