import {
  AGGREGATE_FUNCTIONS,
  type AggregateFn,
  type Aggregation,
  type Command,
  type FieldRef,
  type SortKey,
} from './ast.js';
import { parseDurationSeconds } from './duration.js';
import { LensQLError, mergeSpans, type Span } from './errors.js';
import { LENSQL_LIMITS } from './limits.js';
import { Cursor, describe, isSpanAssignment, parseFieldList, toFieldRef } from './parser-core.js';
import { parseOr } from './parser-expr.js';

const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const atCommandEnd = (c: Cursor): boolean => c.check('PIPE') || c.check('EOF');

function parseAggregation(cursor: Cursor): Aggregation {
  const fnToken = cursor.expect('WORD', 'an aggregate function');
  const fn = fnToken.value.toLowerCase();
  if (!(AGGREGATE_FUNCTIONS as readonly string[]).includes(fn)) {
    throw new LensQLError(
      'PARSE_ERROR',
      `Unknown aggregate '${fnToken.value}'; expected one of ${AGGREGATE_FUNCTIONS.join(', ')}`,
      fnToken.span,
    );
  }
  let field: FieldRef | null = null;
  let end: Span = fnToken.span;
  if (cursor.check('LPAREN')) {
    cursor.next();
    if (!cursor.check('RPAREN')) field = toFieldRef(cursor.next());
    end = cursor.expect('RPAREN', "')' after the aggregate argument").span;
  }
  if (fn !== 'count' && field === null) {
    throw new LensQLError('PARSE_ERROR', `${fn}() requires a field argument`, fnToken.span);
  }
  let name = field ? `${fn}(${field.name})` : `${fn}()`;
  if (cursor.checkKeyword('as')) {
    cursor.next();
    const alias = cursor.expect('WORD', 'an alias after AS');
    if (!ALIAS_RE.test(alias.value)) {
      throw new LensQLError('PARSE_ERROR', `Invalid alias ${describe(alias)}`, alias.span);
    }
    name = alias.value;
    end = alias.span;
  }
  return { fn: fn as AggregateFn, field, name, span: mergeSpans(fnToken.span, end) };
}

function parseSpanAssignment(cursor: Cursor): number {
  cursor.next();
  cursor.next();
  const value = cursor.next();
  const seconds = parseDurationSeconds(value.value);
  if (value.type !== 'WORD' || seconds === null || seconds < LENSQL_LIMITS.minSpanSeconds) {
    throw new LensQLError(
      'PARSE_ERROR',
      `Invalid span ${describe(value)}; use e.g. 30s, 1m, 1h, 1d`,
      value.span,
    );
  }
  return seconds;
}

function parseStats(cursor: Cursor, start: Span): Command {
  const aggregations: Aggregation[] = [parseAggregation(cursor)];
  while (cursor.check('COMMA') && !isSpanAssignment(cursor, 1)) {
    cursor.next();
    aggregations.push(parseAggregation(cursor));
  }
  if (aggregations.length > LENSQL_LIMITS.maxAggregations) {
    throw new LensQLError(
      'LIMIT_EXCEEDED',
      `stats supports at most ${LENSQL_LIMITS.maxAggregations} aggregations`,
      start,
    );
  }
  let groupBy: readonly FieldRef[] = [];
  let spanSeconds: number | null = null;
  while (!atCommandEnd(cursor)) {
    if (cursor.check('COMMA')) {
      cursor.next();
    } else if (cursor.checkKeyword('by') && groupBy.length === 0) {
      cursor.next();
      groupBy = parseFieldList(cursor, atCommandEnd);
    } else if (isSpanAssignment(cursor) && spanSeconds === null) {
      spanSeconds = parseSpanAssignment(cursor);
    } else {
      throw new LensQLError(
        'PARSE_ERROR',
        `Unexpected ${describe(cursor.peek())} in stats`,
        cursor.peek().span,
      );
    }
  }
  if (groupBy.length > LENSQL_LIMITS.maxGroupByFields) {
    throw new LensQLError(
      'LIMIT_EXCEEDED',
      `stats can group by at most ${LENSQL_LIMITS.maxGroupByFields} fields`,
      start,
    );
  }
  return {
    kind: 'stats',
    aggregations,
    groupBy,
    spanSeconds,
    span: mergeSpans(start, cursor.peek().span),
  };
}

function parseSortKey(cursor: Cursor): SortKey {
  const token = cursor.expect('WORD', 'a sort field');
  const descendingPrefix = token.value.startsWith('-');
  const name = descendingPrefix ? token.value.slice(1) : token.value;
  let descending = descendingPrefix;
  let span = token.span;
  if (cursor.checkKeyword('desc') || cursor.checkKeyword('asc')) {
    const dir = cursor.next();
    descending = dir.value.toLowerCase() === 'desc';
    span = mergeSpans(span, dir.span);
  }
  if (name.length === 0) throw new LensQLError('PARSE_ERROR', 'Missing sort field', token.span);
  return { name, descending, span };
}

function parseSort(cursor: Cursor, start: Span): Command {
  const keys: SortKey[] = [parseSortKey(cursor)];
  while (cursor.check('COMMA')) {
    cursor.next();
    keys.push(parseSortKey(cursor));
  }
  return { kind: 'sort', keys, span: mergeSpans(start, keys[keys.length - 1]?.span ?? start) };
}

function parseHead(cursor: Cursor, start: Span): Command {
  if (atCommandEnd(cursor)) return { kind: 'head', count: 10, span: start };
  const token = cursor.expect('NUMBER', 'a row count');
  const count = Number(token.value);
  if (!Number.isInteger(count) || count < 1 || count > LENSQL_LIMITS.maxHead) {
    throw new LensQLError(
      'PARSE_ERROR',
      `head expects an integer between 1 and ${LENSQL_LIMITS.maxHead}`,
      token.span,
    );
  }
  return { kind: 'head', count, span: mergeSpans(start, token.span) };
}

function parseFields(cursor: Cursor, start: Span): Command {
  const fields = parseFieldList(cursor, atCommandEnd);
  if (fields.length > LENSQL_LIMITS.maxFieldsProjection) {
    throw new LensQLError(
      'LIMIT_EXCEEDED',
      `fields supports at most ${LENSQL_LIMITS.maxFieldsProjection} names`,
      start,
    );
  }
  return {
    kind: 'fields',
    fields,
    span: mergeSpans(start, fields[fields.length - 1]?.span ?? start),
  };
}

/** Parses one pipeline command after a `|`. */
export function parseCommand(cursor: Cursor): Command {
  const nameToken = cursor.expect('WORD', 'a command name after |');
  const name = nameToken.value.toLowerCase();
  const command = ((): Command => {
    switch (name) {
      case 'stats':
        return parseStats(cursor, nameToken.span);
      case 'sort':
        return parseSort(cursor, nameToken.span);
      case 'head':
        return parseHead(cursor, nameToken.span);
      case 'fields':
        return parseFields(cursor, nameToken.span);
      case 'where': {
        const expr = parseOr(cursor);
        return { kind: 'where', expr, span: mergeSpans(nameToken.span, expr.span) };
      }
      default:
        throw new LensQLError(
          'PARSE_ERROR',
          `Unknown command '${nameToken.value}'; expected stats, sort, head, fields or where`,
          nameToken.span,
        );
    }
  })();
  if (!atCommandEnd(cursor)) {
    throw new LensQLError(
      'PARSE_ERROR',
      `Unexpected ${describe(cursor.peek())} after ${name}`,
      cursor.peek().span,
    );
  }
  return command;
}
