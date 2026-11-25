import type { Aggregation, Expr, FieldRef, SortKey } from './ast.js';
import type { StatsCommand } from './analyzer.js';
import { LensQLError, type Span } from './errors.js';
import { numericExpr, resolveField, textExpr } from './fields.js';
import { LENSQL_LIMITS } from './limits.js';
import { composeSql, joinSql, likePattern, sql, type SqlFragment } from './sql.js';
import type { TimeRange } from './time-range.js';

export interface OutputColumn {
  /** Compiler-assigned SQL alias; never derived from user text. */
  readonly key: string;
  /** Display name shown to the user and referenced by post-stats commands. */
  readonly name: string;
  readonly type: 'time' | 'text' | 'number';
}

const PERCENTILES: Readonly<Record<string, string>> = {
  p50: '0.5',
  p90: '0.9',
  p95: '0.95',
  p99: '0.99',
};
const BUCKET_ORIGIN = `TIMESTAMPTZ '1970-01-01 00:00:00+00'`;

export const timeBucket = (spanSeconds: number): SqlFragment =>
  sql(`date_bin(make_interval(secs => $?::int), e.timestamp, ${BUCKET_ORIGIN})`, [spanSeconds]);

function aggregateSql(agg: Aggregation): SqlFragment {
  if (agg.fn === 'count' && agg.field === null) return sql('count(*)::float8');
  const ref = agg.field as FieldRef;
  const field = resolveField(ref);
  if (agg.fn === 'count') return composeSql('count({})::float8', textExpr(field));
  if (agg.fn === 'dc') return composeSql('count(DISTINCT {})::float8', textExpr(field));
  const num = numericExpr(field, ref);
  const fraction = PERCENTILES[agg.fn];
  if (fraction)
    return composeSql(`percentile_cont(${fraction}) WITHIN GROUP (ORDER BY {})::float8`, num);
  return composeSql(`${agg.fn}({})::float8`, num);
}

export interface StatsSelect {
  readonly select: SqlFragment;
  readonly groupBy: SqlFragment | null;
  readonly columns: readonly OutputColumn[];
}

export function assertBucketBudget(stats: StatsCommand, range: TimeRange): void {
  if (stats.spanSeconds === null) return;
  const buckets = Math.ceil((range.to.getTime() - range.from.getTime()) / 1000 / stats.spanSeconds);
  if (buckets > LENSQL_LIMITS.maxStatsBuckets) {
    throw new LensQLError(
      'LIMIT_EXCEEDED',
      `span would produce ${buckets} buckets per group; the limit is ${LENSQL_LIMITS.maxStatsBuckets}`,
      stats.span,
    );
  }
}

/** Builds the SELECT list and GROUP BY of the aggregation stage plus its output schema. */
export function compileStatsSelect(stats: StatsCommand): StatsSelect {
  const timeCols =
    stats.spanSeconds === null
      ? []
      : [
          {
            key: 'g_time',
            name: '_time',
            type: 'time' as const,
            sql: timeBucket(stats.spanSeconds),
          },
        ];
  const groupCols = stats.groupBy.map((ref, i) => ({
    key: `g${i}`,
    name: ref.name,
    type: 'text' as const,
    sql: textExpr(resolveField(ref)),
  }));
  const aggCols = stats.aggregations.map((agg, i) => ({
    key: `a${i}`,
    name: agg.name,
    type: 'number' as const,
    sql: aggregateSql(agg),
  }));
  const all = [...timeCols, ...groupCols, ...aggCols];
  const names = all.map((c) => c.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate !== undefined) {
    throw new LensQLError(
      'SEMANTIC_ERROR',
      `Duplicate output column '${duplicate}'; use AS to rename`,
      stats.span,
    );
  }
  const select = joinSql(
    all.map((c) => composeSql(`{} AS ${c.key}`, c.sql)),
    ', ',
  );
  const groupKeys = [...timeCols, ...groupCols].map((c) => sql(c.key));
  return {
    select,
    groupBy: groupKeys.length > 0 ? joinSql(groupKeys, ', ') : null,
    columns: all.map(({ key, name, type }) => ({ key, name, type })),
  };
}

function columnFor(columns: readonly OutputColumn[], name: string, span: Span): OutputColumn {
  const found = columns.find((c) => c.name === name);
  if (!found) {
    throw new LensQLError(
      'SEMANTIC_ERROR',
      `Unknown column '${name}' after stats; available: ${columns.map((c) => c.name).join(', ')}`,
      span,
    );
  }
  return found;
}

/** Compiles a post-aggregation filter against the stats output (outer alias `t`). */
export function compilePostExpr(expr: Expr, columns: readonly OutputColumn[]): SqlFragment {
  const leaf = (f: SqlFragment): SqlFragment => composeSql('COALESCE({}, false)', f);
  switch (expr.kind) {
    case 'and':
      return composeSql(
        '({} AND {})',
        compilePostExpr(expr.left, columns),
        compilePostExpr(expr.right, columns),
      );
    case 'or':
      return composeSql(
        '({} OR {})',
        compilePostExpr(expr.left, columns),
        compilePostExpr(expr.right, columns),
      );
    case 'not':
      return composeSql('(NOT {})', compilePostExpr(expr.expr, columns));
    case 'exists':
      return sql(`(t.${columnFor(columns, expr.field.name, expr.span).key} IS NOT NULL)`);
    case 'compare': {
      const col = columnFor(columns, expr.field.name, expr.field.span);
      const op = expr.op === '!=' ? '<>' : expr.op;
      if (expr.value.kind === 'wildcard') {
        const match = leaf(
          sql(`t.${col.key}::text ILIKE $? ESCAPE '\\'`, [likePattern(expr.value.value, false)]),
        );
        return expr.op === '=' ? match : composeSql('(NOT {})', match);
      }
      if (col.type === 'number') {
        if (expr.value.kind !== 'number') {
          throw new LensQLError(
            'SEMANTIC_ERROR',
            `'${col.name}' is numeric; compare it with a number`,
            expr.value.span,
          );
        }
        return leaf(sql(`t.${col.key} ${op} $?::float8`, [expr.value.value]));
      }
      if (op !== '=' && op !== '<>') {
        throw new LensQLError(
          'SEMANTIC_ERROR',
          `'${expr.op}' is only supported on numeric columns`,
          expr.span,
        );
      }
      return leaf(sql(`t.${col.key}::text ${op} $?`, [expr.value.value]));
    }
    case 'in': {
      const col = columnFor(columns, expr.field.name, expr.field.span);
      return leaf(sql(`t.${col.key}::text = ANY($?::text[])`, [expr.values.map((v) => v.value)]));
    }
    case 'regex': {
      const col = columnFor(columns, expr.field.name, expr.field.span);
      return leaf(sql(`t.${col.key}::text ${expr.negate ? '!~' : '~'} $?`, [expr.pattern]));
    }
    case 'text':
      throw new LensQLError(
        'SEMANTIC_ERROR',
        'Free-text search is not allowed after stats; use a column comparison',
        expr.span,
      );
  }
}

export function compilePostOrder(
  sort: readonly SortKey[] | null,
  columns: readonly OutputColumn[],
): SqlFragment {
  if (sort) {
    return sql(
      sort
        .map(
          (k) =>
            `t.${columnFor(columns, k.name, k.span).key} ${k.descending ? 'DESC' : 'ASC'} NULLS LAST`,
        )
        .join(', '),
    );
  }
  const time = columns.find((c) => c.type === 'time');
  const groups = columns.filter((c) => c.type === 'text').map((c) => `t.${c.key} ASC NULLS LAST`);
  const firstAgg = columns.find((c) => c.type === 'number');
  const keys = time
    ? [`t.${time.key} ASC`, ...groups]
    : [...(firstAgg ? [`t.${firstAgg.key} DESC NULLS LAST`] : []), ...groups];
  return sql(keys.join(', '));
}
