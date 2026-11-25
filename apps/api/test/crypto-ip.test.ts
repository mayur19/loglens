import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  randomToken,
  safeEqual,
  sha256Hex,
  verifyPassword,
} from '../src/modules/auth/crypto.js';
import { normalizeIp } from '../src/modules/auth/ip.js';

describe('password hashing', () => {
  it('round-trips and rejects wrong passwords', async () => {
    const hash = await hashPassword('a very long passphrase');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('a very long passphrase', hash)).toBe(true);
    expect(await verifyPassword('a very long passphrasE', hash)).toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('tokens', () => {
  it('produces url-safe random tokens and stable hashes', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares strings in constant time regardless of length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:198.51.100.1', '198.51.100.1'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:db8:abcd:12::99', '2001:db8:abcd:12::/64'],
    ['2001:0db8:0000:0012:ffff::1', '2001:db8:0:12::/64'],
    ['[2001:db8::1]', '2001:db8:0:0::/64'],
    ['fe80::1%en0', 'fe80:0:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['', 'unknown'],
    [undefined, 'unknown'],
    ['not-an-ip', 'not-an-ip'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected);
  });
});
