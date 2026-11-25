import type { QueryAst } from './ast.js';
import { resolveTimeExpression } from './duration.js';
import { LensQLError, spanOf } from './errors.js';

export interface TimeRange {
  readonly from: Date;
  readonly to: Date;
}

export const MAX_RANGE_DAYS = 90;

/** Query-level earliest/latest override the request range; the result is validated and bounded. */
export function resolveTimeRange(ast: QueryAst, fallback: TimeRange, now: Date): TimeRange {
  const from = ast.earliest
    ? resolveTimeExpression(ast.earliest.value, now, ast.earliest.span)
    : fallback.from;
  const to = ast.latest
    ? resolveTimeExpression(ast.latest.value, now, ast.latest.span)
    : fallback.to;
  const span = ast.earliest?.span ?? ast.latest?.span ?? spanOf(0, 0);
  if (from.getTime() >= to.getTime()) {
    throw new LensQLError(
      'TIME_RANGE_ERROR',
      'The start of the time range must be before its end',
      span,
    );
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new LensQLError(
      'LIMIT_EXCEEDED',
      `Time ranges are limited to ${MAX_RANGE_DAYS} days`,
      span,
    );
  }
  return { from, to };
}
