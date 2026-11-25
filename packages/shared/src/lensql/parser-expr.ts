import type { CompareOp, Expr, FieldRef, Literal } from './ast.js';
import { LensQLError, mergeSpans } from './errors.js';
import { LENSQL_LIMITS } from './limits.js';
import { Cursor, describe, toFieldRef } from './parser-core.js';
import type { Token } from './tokens.js';

const STOP_WORDS = new Set(['and', 'or']);

function literalFrom(token: Token): Literal {
  if (token.type === 'STRING') return { kind: 'string', value: token.value, span: token.span };
  if (token.type === 'NUMBER') return { kind: 'number', value: token.value, span: token.span };
  if (token.type === 'WORD') {
    const kind = token.value.includes('*') ? 'wildcard' : 'string';
    return { kind, value: token.value, span: token.span };
  }
  throw new LensQLError('PARSE_ERROR', `Expected a value but found ${describe(token)}`, token.span);
}

function startsPrimary(cursor: Cursor): boolean {
  const t = cursor.peek();
  if (t.type === 'LPAREN' || t.type === 'STRING' || t.type === 'NUMBER') return true;
  return t.type === 'WORD' && !STOP_WORDS.has(t.value.toLowerCase());
}

function parseComparison(cursor: Cursor, field: FieldRef): Expr {
  const opToken = cursor.next();
  const valueToken = cursor.next();
  const span = mergeSpans(field.span, valueToken.span);
  if (opToken.value === '=~' || opToken.value === '!~') {
    if (valueToken.type !== 'STRING' && valueToken.type !== 'WORD') {
      throw new LensQLError(
        'PARSE_ERROR',
        'Regex comparison needs a quoted pattern',
        valueToken.span,
      );
    }
    if (valueToken.value.length > LENSQL_LIMITS.maxRegexLength) {
      throw new LensQLError('LIMIT_EXCEEDED', 'Regex pattern is too long', valueToken.span);
    }
    return {
      kind: 'regex',
      field,
      negate: opToken.value === '!~',
      pattern: valueToken.value,
      span,
    };
  }
  const op = opToken.value as CompareOp;
  if (valueToken.type === 'WORD' && valueToken.value === '*' && (op === '=' || op === '!=')) {
    const exists: Expr = { kind: 'exists', field, span };
    return op === '=' ? exists : { kind: 'not', expr: exists, span };
  }
  const value = literalFrom(valueToken);
  if (value.kind === 'wildcard' && op !== '=' && op !== '!=') {
    throw new LensQLError('PARSE_ERROR', `Wildcards cannot be used with '${op}'`, valueToken.span);
  }
  return { kind: 'compare', field, op, value, span };
}

function parseInList(cursor: Cursor, field: FieldRef): Expr {
  cursor.next();
  cursor.expect('LPAREN', "'(' after IN");
  const values: Literal[] = [literalFrom(cursor.next())];
  while (cursor.check('COMMA')) {
    cursor.next();
    values.push(literalFrom(cursor.next()));
    if (values.length > LENSQL_LIMITS.maxInValues) {
      throw new LensQLError(
        'LIMIT_EXCEEDED',
        `IN lists are limited to ${LENSQL_LIMITS.maxInValues} values`,
        field.span,
      );
    }
  }
  const close = cursor.expect('RPAREN', "')' to close the IN list");
  if (values.some((v) => v.kind === 'wildcard')) {
    throw new LensQLError('PARSE_ERROR', 'Wildcards are not allowed inside IN lists', field.span);
  }
  return { kind: 'in', field, values, span: mergeSpans(field.span, close.span) };
}

function parsePrimary(cursor: Cursor): Expr {
  const token = cursor.peek();
  if (token.type === 'LPAREN') {
    cursor.next();
    cursor.enter(token.span);
    const inner = parseOr(cursor);
    cursor.leave();
    cursor.expect('RPAREN', "')'");
    return inner;
  }
  if (token.type === 'WORD' && STOP_WORDS.has(token.value.toLowerCase())) {
    throw new LensQLError('PARSE_ERROR', `Unexpected keyword '${token.value}'`, token.span);
  }
  if (cursor.peek(1).type === 'OP') {
    return parseComparison(cursor, toFieldRef(cursor.next()));
  }
  if (
    token.type === 'WORD' &&
    cursor.peek(1).type === 'WORD' &&
    cursor.peek(1).value.toLowerCase() === 'in' &&
    cursor.peek(2).type === 'LPAREN'
  ) {
    return parseInList(cursor, toFieldRef(cursor.next()));
  }
  if (token.type === 'STRING' || token.type === 'NUMBER' || token.type === 'WORD') {
    cursor.next();
    return { kind: 'text', value: literalFrom(token), span: token.span };
  }
  throw new LensQLError('PARSE_ERROR', `Unexpected ${describe(token)}`, token.span);
}

function parseNot(cursor: Cursor): Expr {
  if (cursor.checkKeyword('not')) {
    const notToken = cursor.next();
    cursor.enter(notToken.span);
    const expr = parseNot(cursor);
    cursor.leave();
    return { kind: 'not', expr, span: mergeSpans(notToken.span, expr.span) };
  }
  return parsePrimary(cursor);
}

function parseAnd(cursor: Cursor): Expr {
  let left = parseNot(cursor);
  for (;;) {
    if (cursor.checkKeyword('and')) {
      cursor.next();
    } else if (!startsPrimary(cursor)) {
      return left;
    }
    const right = parseNot(cursor);
    left = { kind: 'and', left, right, span: mergeSpans(left.span, right.span) };
  }
}

/** expr := and ( OR and )* ; and := not ( [AND] not )* ; not := NOT not | primary */
export function parseOr(cursor: Cursor): Expr {
  let left = parseAnd(cursor);
  while (cursor.checkKeyword('or')) {
    cursor.next();
    const right = parseAnd(cursor);
    left = { kind: 'or', left, right, span: mergeSpans(left.span, right.span) };
  }
  return left;
}
