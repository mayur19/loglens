import type { Command, Expr, QueryAst, TimeBound } from './ast.js';
import { LensQLError } from './errors.js';
import { tokenize } from './lexer.js';
import { Cursor, describe } from './parser-core.js';
import { parseCommand } from './parser-commands.js';
import { parseOr } from './parser-expr.js';

const TIME_FIELDS = new Set(['earliest', 'latest']);

interface Extraction {
  readonly expr: Expr | null;
  readonly earliest: TimeBound | null;
  readonly latest: TimeBound | null;
}

const isTimeBound = (expr: Expr): expr is Extract<Expr, { kind: 'compare' }> =>
  expr.kind === 'compare' && TIME_FIELDS.has(expr.field.name.toLowerCase());

function combine(left: Extraction, right: Extraction, span: Expr['span']): Extraction {
  const pick = (a: TimeBound | null, b: TimeBound | null, label: string): TimeBound | null => {
    if (a && b) throw new LensQLError('SEMANTIC_ERROR', `${label} is specified twice`, b.span);
    return a ?? b;
  };
  const expr =
    left.expr && right.expr
      ? ({ kind: 'and', left: left.expr, right: right.expr, span } as const)
      : (left.expr ?? right.expr);
  return {
    expr,
    earliest: pick(left.earliest, right.earliest, 'earliest'),
    latest: pick(left.latest, right.latest, 'latest'),
  };
}

function assertNoTimeBounds(expr: Expr): void {
  if (isTimeBound(expr)) {
    throw new LensQLError(
      'SEMANTIC_ERROR',
      `${expr.field.name} must appear at the top level of the search, not inside OR/NOT or where`,
      expr.span,
    );
  }
  if (expr.kind === 'and' || expr.kind === 'or') {
    assertNoTimeBounds(expr.left);
    assertNoTimeBounds(expr.right);
  } else if (expr.kind === 'not') {
    assertNoTimeBounds(expr.expr);
  }
}

/** Lifts `earliest=` / `latest=` out of the top-level AND chain into explicit bounds. */
function extractTimeBounds(expr: Expr): Extraction {
  if (expr.kind === 'and') {
    return combine(extractTimeBounds(expr.left), extractTimeBounds(expr.right), expr.span);
  }
  if (isTimeBound(expr)) {
    if (expr.op !== '=' || expr.value.kind === 'wildcard') {
      throw new LensQLError('SEMANTIC_ERROR', `${expr.field.name} only supports '='`, expr.span);
    }
    const bound: TimeBound = { value: expr.value.value, span: expr.value.span };
    const isEarliest = expr.field.name.toLowerCase() === 'earliest';
    return { expr: null, earliest: isEarliest ? bound : null, latest: isEarliest ? null : bound };
  }
  assertNoTimeBounds(expr);
  return { expr, earliest: null, latest: null };
}

/** Parses LensQL text into an AST. Throws LensQLError with a precise span on failure. */
export function parseQuery(source: string): QueryAst {
  const cursor = new Cursor(tokenize(source));
  const search = cursor.check('PIPE') || cursor.check('EOF') ? null : parseOr(cursor);
  const commands: Command[] = [];
  while (cursor.check('PIPE')) {
    cursor.next();
    commands.push(parseCommand(cursor));
  }
  if (!cursor.check('EOF')) {
    throw new LensQLError(
      'PARSE_ERROR',
      `Unexpected ${describe(cursor.peek())}`,
      cursor.peek().span,
    );
  }
  commands.forEach((c) => {
    if (c.kind === 'where') assertNoTimeBounds(c.expr);
  });
  const extracted = search
    ? extractTimeBounds(search)
    : { expr: null, earliest: null, latest: null };
  return {
    search: extracted.expr,
    earliest: extracted.earliest,
    latest: extracted.latest,
    commands,
  };
}
