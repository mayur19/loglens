import { describe, expect, it } from 'vitest';
import { LensQLError, parseQuery, type Expr } from '../../src/index.js';

/** Compact S-expression rendering of the search AST for readable assertions. */
function show(expr: Expr | null): string {
  if (!expr) return '∅';
  switch (expr.kind) {
    case 'and':
      return `(and ${show(expr.left)} ${show(expr.right)})`;
    case 'or':
      return `(or ${show(expr.left)} ${show(expr.right)})`;
    case 'not':
      return `(not ${show(expr.expr)})`;
    case 'compare':
      return `(${expr.op} ${expr.field.name} ${expr.value.kind}:${expr.value.value})`;
    case 'regex':
      return `(${expr.negate ? '!~' : '=~'} ${expr.field.name} ${expr.pattern})`;
    case 'in':
      return `(in ${expr.field.name} ${expr.values.map((v) => v.value).join(',')})`;
    case 'exists':
      return `(exists ${expr.field.name})`;
    case 'text':
      return `(text ${expr.value.kind}:${expr.value.value})`;
  }
}

const search = (q: string) => show(parseQuery(q).search);

describe('parseQuery – search expressions', () => {
  it('parses an empty query as match-all', () => {
    const ast = parseQuery('');
    expect(ast.search).toBeNull();
    expect(ast.commands).toEqual([]);
  });

  it('treats adjacent terms as implicit AND', () => {
    expect(search('timeout level=error')).toBe(
      '(and (text string:timeout) (= level string:error))',
    );
  });

  it('gives AND higher precedence than OR', () => {
    expect(search('a OR b c')).toBe('(or (text string:a) (and (text string:b) (text string:c)))');
    expect(search('a and b or c')).toBe(
      '(or (and (text string:a) (text string:b)) (text string:c))',
    );
  });

  it('respects parentheses and NOT', () => {
    expect(search('NOT (level=debug OR level=trace) service=api')).toBe(
      '(and (not (or (= level string:debug) (= level string:trace))) (= service string:api))',
    );
    expect(search('not not a')).toBe('(not (not (text string:a)))');
  });

  it('keywords are case-insensitive', () => {
    expect(search('a Or b AnD NoT c')).toBe(
      '(or (text string:a) (and (text string:b) (not (text string:c))))',
    );
  });

  it('parses all comparison operators and literal kinds', () => {
    expect(search('status>=500 latency<0.25 code!=404 host="web 1" service=api-*')).toBe(
      '(and (and (and (and (>= status number:500) (< latency number:0.25)) (!= code number:404)) (= host string:web 1)) (= service wildcard:api-*))',
    );
  });

  it('parses regex, IN lists and existence checks', () => {
    expect(search('path=~"^/api/v[0-9]+" user_agent!~bot')).toBe(
      '(and (=~ path ^/api/v[0-9]+) (!~ user_agent bot))',
    );
    expect(search('status in (500, 502, "503")')).toBe('(in status 500,502,503)');
    expect(search('user_id=* region!=*')).toBe('(and (exists user_id) (not (exists region)))');
  });

  it('accepts nested attribute paths', () => {
    expect(search('http.request.method=GET')).toBe('(= http.request.method string:GET)');
  });

  it('treats free-text numbers and quoted phrases as text', () => {
    expect(search('"connection reset" 503')).toBe(
      '(and (text string:connection reset) (text number:503))',
    );
    expect(search('fail*')).toBe('(text wildcard:fail*)');
  });

  it('lifts earliest/latest out of the top-level AND chain', () => {
    const ast = parseQuery('earliest=-1h level=error latest=now');
    expect(ast.earliest?.value).toBe('-1h');
    expect(ast.latest?.value).toBe('now');
    expect(show(ast.search)).toBe('(= level string:error)');
  });

  it('allows a query made only of time bounds', () => {
    const ast = parseQuery('earliest="2026-01-01T00:00:00Z"');
    expect(ast.search).toBeNull();
    expect(ast.earliest?.value).toBe('2026-01-01T00:00:00Z');
  });

  it.each([
    ['level=', 'Expected a value'],
    ['(a OR b', "Expected ')'"],
    ['a OR', 'Unexpected end of query'],
    ['AND a', "Unexpected keyword 'AND'"],
    ['a )', "Unexpected ')'"],
    ['"quoted"=x', 'Invalid field name'],
    ['1abc..x=1', 'Invalid field name'],
    ['latency>api-*', "Wildcards cannot be used with '>'"],
    ['status in (1, a*)', 'Wildcards are not allowed inside IN'],
    ['msg=~(', 'Regex comparison needs a quoted pattern'],
    ['earliest=-1h OR a', 'must appear at the top level'],
    ['NOT latest=now', 'must appear at the top level'],
    ['earliest>-1h', "only supports '='"],
    ['earliest=-1h earliest=-2h', 'earliest is specified twice'],
  ])('rejects %s', (q, message) => {
    expect(() => parseQuery(q)).toThrow(message);
  });

  it('limits nesting depth', () => {
    expect(() => parseQuery(`${'('.repeat(40)}a${')'.repeat(40)}`)).toThrow(/nesting/);
    expect(() => parseQuery(`${'NOT '.repeat(40)}a`)).toThrow(/nesting/);
  });

  it('limits IN list size, regex length and field path depth', () => {
    const many = Array.from({ length: 101 }, (_, i) => i).join(',');
    expect(() => parseQuery(`a in (${many})`)).toThrow(/IN lists/);
    expect(() => parseQuery(`a=~"${'x'.repeat(300)}"`)).toThrow(/Regex pattern is too long/);
    expect(() => parseQuery(`${Array.from({ length: 9 }, () => 'a').join('.')}=1`)).toThrow(
      /segments/,
    );
    expect(() => parseQuery(`${'a'.repeat(129)}=1`)).toThrow(/too long/);
  });

  it('reports the span of the offending token', () => {
    try {
      parseQuery('level=error | bogus');
      expect.unreachable();
    } catch (err) {
      expect((err as LensQLError).span).toEqual({ start: 14, end: 19 });
    }
  });
});

describe('parseQuery – pipeline commands', () => {
  it('parses stats with aggregations, aliases, by and span', () => {
    const [cmd] = parseQuery(
      '| stats count(), avg(latency_ms) as avg_ms, p95(latency_ms) by service, host span=5m',
    ).commands;
    expect(cmd).toMatchObject({
      kind: 'stats',
      spanSeconds: 300,
      groupBy: [{ name: 'service' }, { name: 'host' }],
    });
    if (cmd?.kind !== 'stats') throw new Error('expected stats');
    expect(cmd.aggregations.map((a) => [a.fn, a.field?.name ?? null, a.name])).toEqual([
      ['count', null, 'count()'],
      ['avg', 'latency_ms', 'avg_ms'],
      ['p95', 'latency_ms', 'p95(latency_ms)'],
    ]);
  });

  it('accepts span before by, comma-separated span and bare count', () => {
    const [a] = parseQuery('| stats count span=1h by level').commands;
    expect(a).toMatchObject({ kind: 'stats', spanSeconds: 3600, groupBy: [{ name: 'level' }] });
    const [b] = parseQuery('| stats count(), span=30s').commands;
    expect(b).toMatchObject({ kind: 'stats', spanSeconds: 30, groupBy: [] });
    const [c] = parseQuery('| stats count(user) by service, span=1d').commands;
    expect(c).toMatchObject({ kind: 'stats', spanSeconds: 86400, groupBy: [{ name: 'service' }] });
  });

  it('parses sort keys with prefix and suffix directions', () => {
    const [cmd] = parseQuery('| sort -count, service asc, host desc').commands;
    expect(cmd).toMatchObject({
      kind: 'sort',
      keys: [
        { name: 'count', descending: true },
        { name: 'service', descending: false },
        { name: 'host', descending: true },
      ],
    });
  });

  it('parses head with and without a count', () => {
    expect(parseQuery('| head 25').commands[0]).toMatchObject({ kind: 'head', count: 25 });
    expect(parseQuery('| head').commands[0]).toMatchObject({ kind: 'head', count: 10 });
  });

  it('parses fields and where', () => {
    const ast = parseQuery('error | where status>=500 | fields service, status');
    expect(ast.commands.map((c) => c.kind)).toEqual(['where', 'fields']);
    expect(ast.commands[1]).toMatchObject({ fields: [{ name: 'service' }, { name: 'status' }] });
  });

  it.each([
    ['| ', 'Expected a command name'],
    ['| explode', "Unknown command 'explode'"],
    ['| stats median(x)', "Unknown aggregate 'median'"],
    ['| stats avg()', 'avg() requires a field'],
    ['| stats count( by x', "Expected ')' after the aggregate argument"],
    ['| stats count() as 1x', 'Invalid alias'],
    ['| stats count() as "x"', 'Expected an alias'],
    ['| stats count() span=7y', 'Invalid span'],
    ['| stats count() span=0s', 'Invalid span'],
    ['| stats count() whatever', "Unexpected 'whatever' in stats"],
    ['| head 0', 'between 1 and'],
    ['| head 1.5', 'between 1 and'],
    ['| head 99999', 'between 1 and'],
    ['| head x', 'Expected a row count'],
    ['| head 5 6', "Unexpected '6' after head"],
    ['| sort -', 'Missing sort field'],
    ['| where earliest=-1h', 'must appear at the top level'],
  ])('rejects %s', (q, message) => {
    expect(() => parseQuery(q)).toThrow(message);
  });

  it('limits aggregation and group-by counts', () => {
    const aggs = Array.from({ length: 11 }, (_, i) => `count(f${i})`).join(', ');
    expect(() => parseQuery(`| stats ${aggs}`)).toThrow(/at most 10/);
    expect(() => parseQuery('| stats count() by a,b,c,d,e,f')).toThrow(/at most 5/);
    const fields = Array.from({ length: 26 }, (_, i) => `f${i}`).join(',');
    expect(() => parseQuery(`| fields ${fields}`)).toThrow(/at most 25/);
  });
});
