import { describe, expect, it } from 'vitest';
import { LensQLError, LENSQL_LIMITS, tokenize } from '../../src/index.js';

const types = (src: string) => tokenize(src).map((t) => t.type);
const values = (src: string) => tokenize(src).map((t) => t.value);

describe('tokenize', () => {
  it('splits words, operators and punctuation with spans', () => {
    const tokens = tokenize('level=error | head 5');
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ['WORD', 'level'],
      ['OP', '='],
      ['WORD', 'error'],
      ['PIPE', '|'],
      ['WORD', 'head'],
      ['NUMBER', '5'],
      ['EOF', ''],
    ]);
    expect(tokens[2]?.span).toEqual({ start: 6, end: 11 });
  });

  it('recognises every comparison operator, longest match first', () => {
    expect(values('a!=1 b>=2 c<=3 d=~"x" e!~"y" f>4 g<5')).toEqual([
      'a',
      '!=',
      '1',
      'b',
      '>=',
      '2',
      'c',
      '<=',
      '3',
      'd',
      '=~',
      'x',
      'e',
      '!~',
      'y',
      'f',
      '>',
      '4',
      'g',
      '<',
      '5',
      '',
    ]);
  });

  it('classifies numbers including negatives and decimals', () => {
    expect(types('-5 3.14 10 1.2.3 -15m')).toEqual([
      'NUMBER',
      'NUMBER',
      'NUMBER',
      'WORD',
      'WORD',
      'EOF',
    ]);
  });

  it('keeps wildcards, dots, dashes, colons and slashes inside barewords', () => {
    expect(values('api-* http.status 2026-01-01T10:00:00Z /var/log')).toEqual([
      'api-*',
      'http.status',
      '2026-01-01T10:00:00Z',
      '/var/log',
      '',
    ]);
  });

  it('decodes string escapes and reports the raw span', () => {
    const [tok] = tokenize('"a \\"quoted\\" \\\\ \\n\\t"');
    expect(tok?.type).toBe('STRING');
    expect(tok?.value).toBe('a "quoted" \\ \n\t');
    expect(tok?.span.start).toBe(0);
  });

  it('treats SQL metacharacters inside strings as plain data', () => {
    const [tok] = tokenize(`"'; DROP TABLE log_events; --"`);
    expect(tok?.value).toBe(`'; DROP TABLE log_events; --`);
  });

  it.each([
    ['"unterminated', 'Unterminated string literal'],
    ['"bad \\x escape"', 'Invalid escape sequence'],
    ["level='error'", "Unexpected character '''"],
    ['a ; b', "Unexpected character ';'"],
    ['a ! b', "Unexpected character '!'"],
    ['"nul\u0000"', 'NUL characters'],
  ])('rejects %s', (src, message) => {
    expect(() => tokenize(src)).toThrow(message);
  });

  it('enforces query, token and string length limits', () => {
    expect(() => tokenize('a'.repeat(LENSQL_LIMITS.maxQueryLength + 1))).toThrow(/exceeds/);
    expect(() => tokenize('a '.repeat(LENSQL_LIMITS.maxTokens + 1))).toThrow(/tokens/);
    expect(() => tokenize(`"${'x'.repeat(LENSQL_LIMITS.maxStringLength + 1)}"`)).toThrow(
      /String literal/,
    );
  });

  it('reports errors as LensQLError with a span', () => {
    try {
      tokenize('ok ; bad');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LensQLError);
      const e = err as LensQLError;
      expect(e.code).toBe('LEX_ERROR');
      expect(e.span).toEqual({ start: 3, end: 4 });
      expect(e.toJSON()).toMatchObject({ code: 'LEX_ERROR', span: { start: 3, end: 4 } });
    }
  });

  it('returns only EOF for blank input', () => {
    expect(types('   \n\t ')).toEqual(['EOF']);
  });
});
