import { isIPv4, isIPv6 } from 'node:net';

/** Expands an IPv6 address (with optional `::`) into eight 16-bit hextets. */
function expandIPv6(address: string): string[] | null {
  const [head = '', tail, extra] = address.split('::');
  if (extra !== undefined) return null;
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - left.length - right.length;
  if (tail === undefined && missing !== 0) return null;
  const parts = [...left, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...right];
  return parts.length === 8 ? parts.map((h) => h.toLowerCase().replace(/^0+(?=.)/, '')) : null;
}

/**
 * Normalises a client address into a rate-limit key: IPv4-mapped IPv6 becomes plain IPv4 and
 * other IPv6 addresses collapse to their /64 network so a single host cannot rotate addresses
 * inside its allocation to dodge limits.
 */
export function normalizeIp(raw: string | undefined): string {
  const ip =
    (raw ?? '')
      .trim()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && isIPv4(mapped[1] as string)) return mapped[1] as string;
  if (isIPv4(ip)) return ip;
  if (isIPv6(ip)) {
    const hextets = expandIPv6(ip);
    if (hextets) {
      if (hextets.slice(0, 5).every((h) => h === '0') && hextets[5] === 'ffff') {
        const v4 = [hextets[6], hextets[7]].flatMap((h) => {
          const n = parseInt(h as string, 16);
          return [n >> 8, n & 0xff];
        });
        return v4.join('.');
      }
      return `${hextets.slice(0, 4).join(':')}::/64`;
    }
  }
  return ip === '' ? 'unknown' : ip;
}
