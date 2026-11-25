import type { CompareOp, Expr, FieldRef, Literal } from './ast.js';
import { resolveTimeExpression } from './duration.js';
import { LensQLError } from './errors.js';
import { numericExpr, resolveField, textExpr, type ResolvedField } from './fields.js';
import { composeSql, likePattern, sql, type SqlFragment } from './sql.js';

const ORDERING_OPS = new Set<CompareOp>(['>', '>=', '<', '<=']);
const SQL_OP: Readonly<Record<CompareOp, string>> = {
  '=': '=',
  '!=': '<>',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
};

export interface ExprContext {
  readonly now: Date;
}

/** Leaf predicates are wrapped in COALESCE(..., false) so NOT behaves as two-valued logic. */
const leaf = (fragment: SqlFragment): SqlFragment => composeSql('COALESCE({}, false)', fragment);

/** Appends `tail` (containing exactly one `$?`) to a fragment, binding `value` to it. */
const suffix = (base: SqlFragment, tail: string, value: unknown): SqlFragment => ({
  text: base.text + tail,
  params: [...base.params, value],
});

const normalizeValue = (field: ResolvedField, value: string): string =>
  field.kind === 'column' && field.name === 'level' ? value.toLowerCase() : value;

function compareTime(
  field: FieldRef,
  op: CompareOp,
  value: Literal,
  ctx: ExprContext,
): SqlFragment {
  if (value.kind !== 'string') {
    throw new LensQLError(
      'SEMANTIC_ERROR',
      'timestamp comparisons need a time value such as -1h or an ISO date',
      value.span,
    );
  }
  const at = resolveTimeExpression(value.value, ctx.now, value.span);
  return leaf(sql(`e.timestamp ${SQL_OP[op]} $?::timestamptz`, [at.toISOString()]));
}

function compileCompare(expr: Extract<Expr, { kind: 'compare' }>, ctx: ExprContext): SqlFragment {
  const field = resolveField(expr.field);
  const { op, value } = expr;
  if (field.kind === 'column' && field.type === 'time')
    return compareTime(expr.field, op, value, ctx);
  if (value.kind === 'wildcard') {
    const pattern = likePattern(normalizeValue(field, value.value), false);
    const match = leaf(suffix(textExpr(field), ` ILIKE $? ESCAPE '\\'`, pattern));
    return op === '=' ? match : composeSql('(NOT {})', match);
  }
  if (value.kind === 'number' && field.kind === 'attribute') {
    return leaf(suffix(numericExpr(field, expr.field), ` ${SQL_OP[op]} $?::numeric`, value.value));
  }
  if (ORDERING_OPS.has(op)) {
    throw new LensQLError(
      'SEMANTIC_ERROR',
      `'${op}' needs a numeric value and a numeric field; '${expr.field.name}' compared with ${value.kind === 'number' ? 'a number' : 'text'}`,
      expr.span,
    );
  }
  return leaf(suffix(textExpr(field), ` ${SQL_OP[op]} $?`, normalizeValue(field, value.value)));
}

function compileIn(expr: Extract<Expr, { kind: 'in' }>): SqlFragment {
  const field = resolveField(expr.field);
  if (field.kind === 'column' && field.type === 'time') {
    throw new LensQLError('SEMANTIC_ERROR', 'IN is not supported for timestamp', expr.span);
  }
  const allNumbers = expr.values.every((v) => v.kind === 'number');
  if (allNumbers && field.kind === 'attribute') {
    const values = expr.values.map((v) => v.value);
    return leaf(suffix(numericExpr(field, expr.field), ' = ANY($?::numeric[])', values));
  }
  const values = expr.values.map((v) => normalizeValue(field, v.value));
  return leaf(suffix(textExpr(field), ' = ANY($?::text[])', values));
}

function compileRegex(expr: Extract<Expr, { kind: 'regex' }>): SqlFragment {
  const field = resolveField(expr.field);
  if (field.kind === 'column' && field.type === 'time') {
    throw new LensQLError(
      'SEMANTIC_ERROR',
      'Regex matching is not supported for timestamp',
      expr.span,
    );
  }
  return leaf(suffix(textExpr(field), expr.negate ? ' !~ $?' : ' ~ $?', expr.pattern));
}

function compileExists(expr: Extract<Expr, { kind: 'exists' }>): SqlFragment {
  const field = resolveField(expr.field);
  if (field.kind === 'column') return sql(`(${field.column} IS NOT NULL)`);
  return sql(`(COALESCE(jsonb_typeof(e.attributes #> $?::text[]), 'null') <> 'null')`, [
    field.path,
  ]);
}

/** Compiles a pre-aggregation boolean expression over log_events (alias `e`). */
export function compileExpr(expr: Expr, ctx: ExprContext): SqlFragment {
  switch (expr.kind) {
    case 'and':
      return composeSql('({} AND {})', compileExpr(expr.left, ctx), compileExpr(expr.right, ctx));
    case 'or':
      return composeSql('({} OR {})', compileExpr(expr.left, ctx), compileExpr(expr.right, ctx));
    case 'not':
      return composeSql('(NOT {})', compileExpr(expr.expr, ctx));
    case 'compare':
      return compileCompare(expr, ctx);
    case 'in':
      return compileIn(expr);
    case 'regex':
      return compileRegex(expr);
    case 'exists':
      return compileExists(expr);
    case 'text':
      return leaf(sql(`e.message ILIKE $? ESCAPE '\\'`, [likePattern(expr.value.value, true)]));
  }
}
