import { describe, expect, it } from 'vitest';
import { compileHistogram, compileQuery, EVENT_COLUMNS, LensQLError } from '../../src/index.js';
import { ctx, ORG } from './fixtures.js';

const BASE_PARAMS = [ORG, '2026-03-10T11:00:00.000Z', '2026-03-10T12:00:00.000Z'];

describe('compileQuery – events mode', () => {
  it('always scopes by tenant and time range and orders newest first', () => {
    const q = compileQuery('', ctx());
    expect(q.mode).toBe('events');
    expect(q.text).toBe(
      'SELECT e.id::text AS id, e.timestamp AS timestamp, e.level AS level, e.service AS service, ' +
        'e.host AS host, e.source AS source, e.message AS message, e.attributes AS attributes ' +
        'FROM log_events e WHERE e.organization_id = $1::uuid AND e.timestamp >= $2::timestamptz ' +
        'AND e.timestamp < $3::timestamptz ORDER BY e.timestamp DESC, e.id DESC LIMIT $4::int',
    );
    expect(q.values).toEqual([...BASE_PARAMS, 100]);
    expect(q.columns).toEqual(EVENT_COLUMNS);
    expect(q.limit).toBe(100);
  });

  it('compiles free text to an escaped ILIKE over message', () => {
    const q = compileQuery('"100% done_now"', ctx());
    expect(q.text).toContain(`COALESCE(e.message ILIKE $4 ESCAPE '\\', false)`);
    expect(q.values[3]).toBe('%100\\% done\\_now%');
  });

  it('compiles column equality, inequality and level normalisation', () => {
    const q = compileQuery('level=ERROR service!=billing', ctx());
    expect(q.text).toContain('COALESCE(e.level = $4, false) AND COALESCE(e.service <> $5, false)');
    expect(q.values.slice(3, 5)).toEqual(['error', 'billing']);
  });

  it('compiles wildcards on fields to anchored ILIKE and negated wildcards with NOT', () => {
    const q = compileQuery('host=web-* service!=*-canary', ctx());
    expect(q.text).toContain(`COALESCE(e.host ILIKE $4 ESCAPE '\\', false)`);
    expect(q.text).toContain(`(NOT COALESCE(e.service ILIKE $5 ESCAPE '\\', false))`);
    expect(q.values.slice(3, 5)).toEqual(['web-%', '%-canary']);
  });

  it('compiles numeric attribute comparisons through a non-throwing numeric cast', () => {
    const q = compileQuery('http.status>=500', ctx());
    expect(q.text).toContain(`jsonb_typeof(e.attributes #> $4::text[]) = 'number'`);
    expect(q.text).toContain(`::numeric END) >= $9::numeric`);
    expect(q.values.slice(3, 8)).toEqual(Array(5).fill(['http', 'status']));
    expect(q.values[8]).toBe('500');
  });

  it('strips an explicit attributes. prefix from paths', () => {
    const q = compileQuery('attributes.user.id=42x', ctx());
    expect(q.values[3]).toEqual(['user', 'id']);
  });

  it('compiles string attribute equality via #>>', () => {
    const q = compileQuery('region="eu-west-1"', ctx());
    expect(q.text).toContain('COALESCE((e.attributes #>> $4::text[]) = $5, false)');
    expect(q.values.slice(3, 5)).toEqual([['region'], 'eu-west-1']);
  });

  it('compiles IN lists as = ANY with typed arrays', () => {
    const num = compileQuery('status in (500, 503)', ctx());
    expect(num.text).toContain('= ANY($9::numeric[])');
    expect(num.values[8]).toEqual(['500', '503']);
    const text = compileQuery('level in (WARN, error)', ctx());
    expect(text.text).toContain('COALESCE(e.level = ANY($4::text[]), false)');
    expect(text.values[3]).toEqual(['warn', 'error']);
    const mixed = compileQuery('code in (1, "x")', ctx());
    expect(mixed.text).toContain('= ANY($5::text[])');
  });

  it('compiles regex and negated regex', () => {
    const q = compileQuery('message=~"time(d)?out" host!~"^db"', ctx());
    expect(q.text).toContain('COALESCE(e.message ~ $4, false) AND COALESCE(e.host !~ $5, false)');
    expect(q.values.slice(3, 5)).toEqual(['time(d)?out', '^db']);
  });

  it('compiles existence checks for columns and attributes', () => {
    const q = compileQuery('trace_id=* user!=*', ctx());
    expect(q.text).toContain('(e.trace_id IS NOT NULL)');
    expect(q.text).toContain(
      `(NOT (COALESCE(jsonb_typeof(e.attributes #> $4::text[]), 'null') <> 'null'))`,
    );
  });

  it('compiles boolean structure with explicit parentheses', () => {
    const q = compileQuery('(a OR b) NOT c', ctx());
    expect(q.text).toMatch(/\(\(COALESCE\(.*\) OR COALESCE\(.*\)\) AND \(NOT COALESCE\(.*\)\)\)/);
  });

  it('compiles timestamp comparisons with relative and absolute times', () => {
    const q = compileQuery('timestamp>=-30m _time<"2026-03-10T11:50:00Z"', ctx());
    expect(q.text).toContain('COALESCE(e.timestamp >= $4::timestamptz, false)');
    expect(q.values.slice(3, 5)).toEqual(['2026-03-10T11:30:00.000Z', '2026-03-10T11:50:00.000Z']);
  });

  it('applies earliest/latest from the query instead of the request range', () => {
    const q = compileQuery('earliest=-15m latest=-5m', ctx());
    expect(q.values.slice(1, 3)).toEqual(['2026-03-10T11:45:00.000Z', '2026-03-10T11:55:00.000Z']);
    expect(q.range.from.toISOString()).toBe('2026-03-10T11:45:00.000Z');
  });

  it('merges where commands into the filter', () => {
    const q = compileQuery('error | where service=api', ctx());
    expect(q.text).toContain('COALESCE(e.message ILIKE $4');
    expect(q.text).toContain('COALESCE(e.service = $5, false)');
  });

  it('honours head but never exceeds maxRows', () => {
    expect(compileQuery('| head 7', ctx()).limit).toBe(7);
    expect(compileQuery('| head 5000', ctx({ maxRows: 1000 })).limit).toBe(1000);
  });

  it('compiles sort over columns and attributes with a stable tiebreaker', () => {
    const q = compileQuery('| sort -service, duration_ms', ctx());
    expect(q.text).toContain(
      'ORDER BY e.service DESC NULLS LAST, (e.attributes #>> $4::text[]) ASC NULLS LAST, e.id DESC',
    );
  });

  it('projects requested fields with compiler-assigned aliases', () => {
    const q = compileQuery('| fields service, http.status, _time', ctx());
    expect(q.text).toContain(
      'e.id::text AS id, e.timestamp AS timestamp, e.service AS f0, (e.attributes #>> $1::text[]) AS f1, e.timestamp AS f2',
    );
    expect(q.columns.map((c) => [c.key, c.name, c.type])).toEqual([
      ['id', 'id', 'text'],
      ['timestamp', 'timestamp', 'time'],
      ['f0', 'service', 'text'],
      ['f1', 'http.status', 'text'],
      ['f2', '_time', 'time'],
    ]);
  });
});

describe('compileQuery – stats mode', () => {
  it('compiles a grouped aggregation with compiler-assigned aliases and deterministic order', () => {
    const q = compileQuery('level=error | stats count() by service', ctx());
    expect(q.mode).toBe('table');
    expect(q.text).toBe(
      'SELECT * FROM (SELECT e.service AS g0, count(*)::float8 AS a0 FROM log_events e WHERE ' +
        'e.organization_id = $1::uuid AND e.timestamp >= $2::timestamptz AND e.timestamp < $3::timestamptz ' +
        'AND COALESCE(e.level = $4, false) GROUP BY g0) t ORDER BY t.a0 DESC NULLS LAST, t.g0 ASC NULLS LAST LIMIT $5::int',
    );
    expect(q.values).toEqual([...BASE_PARAMS, 'error', 1000]);
    expect(q.columns).toEqual([
      { key: 'g0', name: 'service', type: 'text' },
      { key: 'a0', name: 'count()', type: 'number' },
    ]);
  });

  it('compiles time-bucketed series ordered by time', () => {
    const q = compileQuery('| stats count() by level span=5m', ctx());
    expect(q.text).toContain(
      "date_bin(make_interval(secs => $1::int), e.timestamp, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS g_time",
    );
    expect(q.text).toContain('GROUP BY g_time, g0');
    expect(q.text).toContain('ORDER BY t.g_time ASC, t.g0 ASC NULLS LAST');
    expect(q.values[0]).toBe(300);
    expect(q.columns[0]).toEqual({ key: 'g_time', name: '_time', type: 'time' });
  });

  it('compiles every aggregate function', () => {
    const q = compileQuery(
      '| stats count(user), dc(user), sum(b), avg(b), min(b), max(b), p50(b), p90(b), p95(b), p99(b)',
      ctx(),
    );
    for (const fragment of [
      'count((e.attributes #>> $1::text[]))::float8 AS a0',
      'count(DISTINCT (e.attributes #>> $2::text[]))::float8 AS a1',
      '::numeric END))::float8 AS a2',
      'avg((CASE',
      'min((CASE',
      'max((CASE',
      'percentile_cont(0.5) WITHIN GROUP (ORDER BY',
      'percentile_cont(0.9) WITHIN GROUP',
      'percentile_cont(0.95) WITHIN GROUP',
      'percentile_cont(0.99) WITHIN GROUP',
    ]) {
      expect(q.text).toContain(fragment);
    }
    expect(q.text).not.toContain('GROUP BY');
  });

  it('supports post-stats where, sort and head on output columns', () => {
    const q = compileQuery(
      '| stats count() as hits, avg(latency) by service | where hits>10 AND service!=test | sort -hits | head 3',
      ctx(),
    );
    expect(q.text).toContain(') t WHERE (COALESCE(t.a0 > $');
    expect(q.text).toContain('COALESCE(t.g0::text <> $');
    expect(q.text).toContain('ORDER BY t.a0 DESC NULLS LAST LIMIT');
    expect(q.limit).toBe(3);
    expect(q.values.slice(-3)).toEqual(['10', 'test', 3]);
  });

  it('supports post-stats wildcard, IN, regex, exists and NOT', () => {
    const q = compileQuery(
      '| stats count() by service | where service=api* OR service in (a,b) OR service=~"^x" OR NOT service=*',
      ctx(),
    );
    expect(q.text).toContain('t.g0::text ILIKE');
    expect(q.text).toContain('t.g0::text = ANY($');
    expect(q.text).toContain('t.g0::text ~ $');
    expect(q.text).toContain('(NOT (t.g0 IS NOT NULL))');
    const neg = compileQuery('| stats count() by service | where service!=api*', ctx());
    expect(neg.text).toContain('(NOT COALESCE(t.g0::text ILIKE');
  });

  it.each([
    ['| stats count() by service | where nope>1', "Unknown column 'nope'"],
    ['| stats count() | where "count()">1', 'Invalid field name'],
    ['| stats count() as c | where c=abc', 'is numeric'],
    ['| stats count() by service | where service>abc', 'only supported on numeric'],
    ['| stats count() | where oops', 'Free-text search is not allowed after stats'],
    ['| stats count() as c | sort -missing', "Unknown column 'missing'"],
    ['| stats count(), count()', "Duplicate output column 'count()'"],
    ['| stats avg(service)', "Field 'service' is not numeric"],
  ])('rejects %s', (q, message) => {
    expect(() => compileQuery(q, ctx())).toThrow(message);
  });

  it('caps the number of time buckets', () => {
    expect(() =>
      compileQuery(
        '| stats count() span=1s',
        ctx({
          range: { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-03-10T00:00:00Z') },
        }),
      ),
    ).toThrow(/buckets/);
  });
});

describe('compileQuery – semantic validation', () => {
  it.each([
    ['service>api', "'>' needs a numeric value"],
    ['level<5', "'<' needs a numeric value"],
    ['timestamp=5', 'timestamp comparisons need a time value'],
    ['timestamp>"yesterday"', "Cannot interpret time 'yesterday'"],
    ['timestamp in (a)', 'IN is not supported for timestamp'],
    ['_time=~"x"', 'Regex matching is not supported for timestamp'],
    ['| head 5 | where a=1', "'where' cannot follow head"],
    ['| sort a | where b=1', 'where must come before sort'],
    ['| fields a | fields b', 'fields may only appear once'],
    ['| sort a | sort b', 'sort may only appear once'],
    ['| head 5 | stats count()', 'stats after head'],
    ['| sort a | stats count()', 'sort and fields before stats have no effect'],
    ['| stats count() | stats count()', 'stats may only appear once'],
    ['| stats count() | fields a', 'fields cannot be used after stats'],
    ['| sort 9bad', "Invalid field name '9bad'"],
    ['earliest=-1h latest=-2h', 'start of the time range must be before its end'],
    ['earliest=-100d', 'limited to 90 days'],
  ])('rejects %s', (q, message) => {
    expect(() => compileQuery(q, ctx())).toThrow(message);
  });

  it('rejects a non-UUID tenant id and invalid row caps before compiling', () => {
    expect(() => compileQuery('', ctx({ organizationId: "x' OR '1'='1" }))).toThrow(
      'organizationId must be a UUID',
    );
    expect(() => compileQuery('', ctx({ maxRows: 0 }))).toThrow('maxRows');
  });

  it('accepts a pre-parsed AST', async () => {
    const { parseQuery } = await import('../../src/index.js');
    expect(compileQuery(parseQuery('error'), ctx()).mode).toBe('events');
  });

  it('wraps failures in LensQLError with spans', () => {
    try {
      compileQuery('service>api', ctx());
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LensQLError);
      expect((err as LensQLError).code).toBe('SEMANTIC_ERROR');
      expect((err as LensQLError).span).toEqual({ start: 0, end: 11 });
    }
  });
});

describe('compileHistogram', () => {
  it('buckets the filtered search and ignores stats commands', () => {
    const h = compileHistogram('level=error | stats count() by service', ctx(), 60);
    expect(h.bucketSeconds).toBe(60);
    expect(h.text).toBe(
      "SELECT date_bin(make_interval(secs => $1::int), e.timestamp, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket, " +
        'count(*)::float8 AS count FROM log_events e WHERE e.organization_id = $2::uuid AND e.timestamp >= $3::timestamptz ' +
        'AND e.timestamp < $4::timestamptz AND COALESCE(e.level = $5, false) GROUP BY 1 ORDER BY 1',
    );
    expect(h.values).toEqual([60, ...BASE_PARAMS, 'error']);
  });

  it('validates the bucket target', () => {
    expect(() => compileHistogram('', ctx(), 0)).toThrow(/targetBuckets/);
    expect(() => compileHistogram('', ctx(), 501)).toThrow(/targetBuckets/);
    expect(() => compileHistogram('', ctx({ organizationId: 'nope' }))).toThrow(/UUID/);
  });

  it('uses the default target and accepts an AST', async () => {
    const { parseQuery } = await import('../../src/index.js');
    expect(compileHistogram(parseQuery('a'), ctx()).bucketSeconds).toBe(60);
  });
});
