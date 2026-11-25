import { describe, expect, it } from 'vitest';
import { extractBearer, parseApiKey } from '../../src/index.js';

const SECRET = 'A'.repeat(40) + '-_9';

describe('parseApiKey', () => {
  it('extracts the lookup prefix from a well-formed key', () => {
    expect(parseApiKey(`llk_Ab12Cd34_${SECRET}`)).toEqual({
      prefix: 'Ab12Cd34',
      token: `llk_Ab12Cd34_${SECRET}`,
    });
    expect(parseApiKey(`  llk_Ab12Cd34_${SECRET} `)?.prefix).toBe('Ab12Cd34');
  });

  it.each([
    '',
    'llk_short_x',
    `xxx_Ab12Cd34_${SECRET}`,
    `llk_Ab12Cd3!_${SECRET}`,
    `llk_Ab12Cd34_${SECRET}x`,
  ])('rejects %s', (key) => {
    expect(parseApiKey(key)).toBeNull();
  });
});

describe('extractBearer', () => {
  it('reads bearer tokens case-insensitively', () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('bearer   abc ')).toBe('abc');
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer a b'])('rejects %s', (header) => {
    expect(extractBearer(header)).toBeNull();
  });
});
