import { LensQLError, mergeSpans, spanOf, type Span } from './errors.js';
import { LENSQL_LIMITS } from './limits.js';
import { isKeyword, type Token, type TokenType } from './tokens.js';
import type { FieldRef } from './ast.js';

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;

/**
 * Token cursor shared by the expression and command parsers. The cursor owns the
 * only piece of mutable state in the front end (the read position).
 */
export class Cursor {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  peek(offset = 0): Token {
    const at = Math.min(this.index + offset, this.tokens.length - 1);
    return this.tokens[at] as Token;
  }

  next(): Token {
    const current = this.peek();
    if (current.type !== 'EOF') this.index += 1;
    return current;
  }

  check(type: TokenType, value?: string): boolean {
    const current = this.peek();
    return current.type === type && (value === undefined || current.value === value);
  }

  checkKeyword(keyword: string): boolean {
    return isKeyword(this.peek(), keyword);
  }

  expect(type: TokenType, what: string): Token {
    const current = this.peek();
    if (current.type !== type) {
      throw new LensQLError(
        'PARSE_ERROR',
        `Expected ${what} but found ${describe(current)}`,
        current.span,
      );
    }
    return this.next();
  }

  enter(span: Span): void {
    this.depth += 1;
    if (this.depth > LENSQL_LIMITS.maxDepth) {
      throw new LensQLError(
        'LIMIT_EXCEEDED',
        `Expression nesting exceeds ${LENSQL_LIMITS.maxDepth}`,
        span,
      );
    }
  }

  leave(): void {
    this.depth -= 1;
  }
}

export function describe(token: Token): string {
  if (token.type === 'EOF') return 'end of query';
  if (token.type === 'STRING') return 'a quoted string';
  return `'${token.value}'`;
}

export function toFieldRef(token: Token): FieldRef {
  if (token.type !== 'WORD' || !FIELD_RE.test(token.value)) {
    throw new LensQLError('PARSE_ERROR', `Invalid field name ${describe(token)}`, token.span);
  }
  if (token.value.length > LENSQL_LIMITS.maxFieldNameLength) {
    throw new LensQLError('LIMIT_EXCEEDED', 'Field name is too long', token.span);
  }
  if (token.value.split('.').length > LENSQL_LIMITS.maxPathSegments) {
    throw new LensQLError('LIMIT_EXCEEDED', 'Field path has too many segments', token.span);
  }
  return { name: token.value, span: token.span };
}

export function parseFieldList(cursor: Cursor, stop: (c: Cursor) => boolean): readonly FieldRef[] {
  const fields: FieldRef[] = [toFieldRef(cursor.next())];
  while (cursor.check('COMMA') && !stop(cursor)) {
    const save = cursor.peek(1);
    if (save.type === 'WORD' && isSpanAssignment(cursor, 1)) break;
    cursor.next();
    fields.push(toFieldRef(cursor.next()));
  }
  return fields;
}

export function isSpanAssignment(cursor: Cursor, offset = 0): boolean {
  return isKeyword(cursor.peek(offset), 'span') && cursor.peek(offset + 1).value === '=';
}

export const spanFrom = (first: Span, last: Span): Span => mergeSpans(first, last);
export const pointSpan = (at: number): Span => spanOf(at, at);
