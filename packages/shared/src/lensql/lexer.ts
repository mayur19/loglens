import { LensQLError, spanOf } from './errors.js';
import { LENSQL_LIMITS } from './limits.js';
import type { Token, TokenType } from './tokens.js';

const BAREWORD_CHAR = /[A-Za-z0-9_.\-*:/@]/;
const NUMBER_RE = /^-?(?:\d+)(?:\.\d+)?$/;
const TWO_CHAR_OPS = new Set(['!=', '>=', '<=', '=~', '!~']);
const ONE_CHAR_OPS = new Set(['=', '>', '<']);
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', n: '\n', t: '\t' };

const token = (type: TokenType, value: string, start: number, end: number): Token => ({
  type,
  value,
  span: spanOf(start, end),
});

function readString(src: string, start: number): { token: Token; next: number } {
  let i = start + 1;
  let out = '';
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '"') {
      return { token: token('STRING', out, start, i + 1), next: i + 1 };
    }
    if (ch === '\\') {
      const esc = src[i + 1];
      const decoded = esc === undefined ? undefined : ESCAPES[esc];
      if (decoded === undefined) {
        throw new LensQLError('LEX_ERROR', 'Invalid escape sequence in string', spanOf(i, i + 2));
      }
      out += decoded;
      i += 2;
    } else {
      if (ch === '\u0000') {
        throw new LensQLError('LEX_ERROR', 'NUL characters are not allowed', spanOf(i, i + 1));
      }
      out += ch;
      i += 1;
    }
    if (out.length > LENSQL_LIMITS.maxStringLength) {
      throw new LensQLError(
        'LIMIT_EXCEEDED',
        `String literal exceeds ${LENSQL_LIMITS.maxStringLength} characters`,
        spanOf(start, i),
      );
    }
  }
  throw new LensQLError('LEX_ERROR', 'Unterminated string literal', spanOf(start, src.length));
}

function readWord(src: string, start: number): { token: Token; next: number } {
  let i = start;
  while (i < src.length && BAREWORD_CHAR.test(src[i] as string)) i += 1;
  const raw = src.slice(start, i);
  const type: TokenType = NUMBER_RE.test(raw) ? 'NUMBER' : 'WORD';
  return { token: token(type, raw, start, i), next: i };
}

function readSymbol(src: string, i: number): { token: Token; next: number } | null {
  const ch = src[i] as string;
  const pair = src.slice(i, i + 2);
  if (TWO_CHAR_OPS.has(pair)) return { token: token('OP', pair, i, i + 2), next: i + 2 };
  if (ONE_CHAR_OPS.has(ch)) return { token: token('OP', ch, i, i + 1), next: i + 1 };
  const single: Readonly<Record<string, TokenType>> = {
    '(': 'LPAREN',
    ')': 'RPAREN',
    '|': 'PIPE',
    ',': 'COMMA',
  };
  const type = single[ch];
  return type ? { token: token(type, ch, i, i + 1), next: i + 1 } : null;
}

/** Converts LensQL source text into a flat token list terminated by an EOF token. */
export function tokenize(src: string): readonly Token[] {
  if (src.length > LENSQL_LIMITS.maxQueryLength) {
    throw new LensQLError(
      'LIMIT_EXCEEDED',
      `Query exceeds ${LENSQL_LIMITS.maxQueryLength} characters`,
      spanOf(LENSQL_LIMITS.maxQueryLength, src.length),
    );
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const step =
      ch === '"'
        ? readString(src, i)
        : BAREWORD_CHAR.test(ch)
          ? readWord(src, i)
          : readSymbol(src, i);
    if (!step) {
      throw new LensQLError('LEX_ERROR', `Unexpected character '${ch}'`, spanOf(i, i + 1));
    }
    tokens.push(step.token);
    if (tokens.length > LENSQL_LIMITS.maxTokens) {
      throw new LensQLError(
        'LIMIT_EXCEEDED',
        `Query exceeds ${LENSQL_LIMITS.maxTokens} tokens`,
        step.token.span,
      );
    }
    i = step.next;
  }
  tokens.push(token('EOF', '', src.length, src.length));
  return tokens;
}
