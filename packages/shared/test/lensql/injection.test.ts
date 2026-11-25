import { describe, expect, it } from 'vitest';
import { compileHistogram, compileQuery, LensQLError } from '../../src/index.js';
import { ctx } from './fixtures.js';

/**
 * The SQL text must only ever contain compiler-owned tokens. These payloads either fail to
 * parse or end up verbatim inside the bound parameter list – never inside the statement text.
 */
const PAYLOADS = [
  `'; DROP TABLE log_events; --`,
  `" OR 1=1 --`,
  `x'); DELETE FROM users; --`,
  `1; SELECT pg_sleep(10)`,
  `$1`,
  `$$ || current_user || $$`,
  `\\'; TRUNCATE sessions; --`,
  `e.organization_id IS NOT NULL OR 'a'='a`,
  `/* comment */ UNION SELECT password_hash FROM users`,
  `%' OR '%'='`,
];

const FORBIDDEN_IN_TEXT =
  /DROP|DELETE|TRUNCATE|UNION|pg_sleep|password_hash|current_user|--|\/\*|;/i;

describe('SQL injection resistance', () => {
  it.each(PAYLOADS)('keeps quoted payload %s out of the SQL text', (payload) => {
    const escaped = payload.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const queries = [
      `"${escaped}"`,
      `message="${escaped}"`,
      `user.name="${escaped}"`,
      `service in ("${escaped}", ok)`,
      `message=~"${escaped.slice(0, 200)}"`,
      `| stats count() by service | where service="${escaped}"`,
    ];
    for (const q of queries) {
      const compiled = compileQuery(q, ctx());
      expect(compiled.text).not.toMatch(FORBIDDEN_IN_TEXT);
    }
    // Exact comparisons bind the payload byte-for-byte as a parameter.
    expect(compileQuery(`message="${escaped}"`, ctx()).values).toContain(payload);
    expect(compileQuery(`user.name="${escaped}"`, ctx()).values).toContain(payload);
  });

  it.each([
    `level=error; DROP TABLE log_events`,
    `level='error'`,
    `| stats count() as "a0; DROP"`,
    `| stats count() as x--y`,
    `| sort service; DROP TABLE x`,
  ])('rejects unquoted SQL syntax: %s', (q) => {
    expect(() => compileQuery(q, ctx())).toThrow(LensQLError);
  });

  it.each([`level=error -- comment`, `level=error /* x */`])(
    'treats comment markers as search text: %s',
    (q) => {
      const compiled = compileQuery(q, ctx());
      expect(compiled.text).not.toMatch(FORBIDDEN_IN_TEXT);
      expect(
        compiled.values.some(
          (v) => typeof v === 'string' && (v.includes('--') || v.includes('/%')),
        ),
      ).toBe(true);
    },
  );

  it('never interpolates field names: hostile paths are rejected or bound as arrays', () => {
    expect(() => compileQuery(`"x').y"=1`, ctx())).toThrow(/Invalid field name/);
    const q = compileQuery('http.user-agent=1x', ctx());
    expect(q.text).not.toContain('user-agent');
    expect(q.values).toContainEqual(['http', 'user-agent']);
  });

  it('never interpolates aliases: user aliases map to compiler-assigned column keys', () => {
    const q = compileQuery('| stats count() as DROP_TABLE by service | sort -DROP_TABLE', ctx());
    expect(q.text).not.toContain('DROP_TABLE');
    expect(q.columns.find((c) => c.name === 'DROP_TABLE')?.key).toBe('a0');
  });

  it('binds numbers as strings cast to numeric, so huge literals cannot change the statement', () => {
    const q = compileQuery(`bytes>${'9'.repeat(60)}`, ctx());
    expect(q.text).toMatch(/> \$\d+::numeric/);
    expect(q.values).toContain('9'.repeat(60));
  });

  it('keeps every statement tenant-scoped even with OR at the top level', () => {
    for (const q of ['a OR b', 'NOT a', '| stats count()', 'x=* OR y!=*']) {
      const compiled = compileQuery(q, ctx());
      expect(compiled.text).toMatch(/WHERE e\.organization_id = \$\d+::uuid AND e\.timestamp >= /);
      expect(compiled.text).toMatch(
        /AND \(\(?COALESCE|AND \(NOT|AND COALESCE|GROUP BY|\) t ORDER|LIMIT|AND \(/,
      );
    }
    const h = compileHistogram('a OR b', ctx());
    expect(h.text).toContain(
      'e.organization_id = $2::uuid AND e.timestamp >= $3::timestamptz AND e.timestamp < $4::timestamptz AND (',
    );
  });

  it('wraps a top-level OR so it cannot escape the tenant predicate', () => {
    const q = compileQuery('a OR b', ctx());
    expect(q.text).toContain('AND (COALESCE(e.message ILIKE $4');
  });
});
