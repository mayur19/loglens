import { analyze, type QueryPlan } from './analyzer.js';
import type { QueryAst, SortKey } from './ast.js';
import { compileExpr } from './compile-expr.js';
import {
  assertBucketBudget,
  compilePostExpr,
  compilePostOrder,
  compileStatsSelect,
  timeBucket,
  type OutputColumn,
} from './compile-stats.js';
import { LensQLError, spanOf } from './errors.js';
import { resolveField, textExpr } from './fields.js';
import { chooseBucketSeconds } from './histogram.js';
import { parseQuery } from './parser.js';
import { composeSql, finalizeSql, joinSql, sql, type FinalSql, type SqlFragment } from './sql.js';
import { resolveTimeRange, type TimeRange } from './time-range.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CompileContext {
  readonly organizationId: string;
  readonly range: TimeRange;
  readonly now: Date;
  readonly defaultLimit: number;
  readonly maxRows: number;
}

export type CompiledQuery = FinalSql & {
  readonly mode: 'events' | 'table';
  readonly columns: readonly OutputColumn[];
  readonly range: TimeRange;
  readonly limit: number;
};

export type CompiledHistogram = FinalSql & {
  readonly bucketSeconds: number;
  readonly range: TimeRange;
};

export const EVENT_COLUMNS: readonly OutputColumn[] = Object.freeze([
  { key: 'id', name: 'id', type: 'text' },
  { key: 'timestamp', name: 'timestamp', type: 'time' },
  { key: 'level', name: 'level', type: 'text' },
  { key: 'service', name: 'service', type: 'text' },
  { key: 'host', name: 'host', type: 'text' },
  { key: 'source', name: 'source', type: 'text' },
  { key: 'message', name: 'message', type: 'text' },
  { key: 'attributes', name: 'attributes', type: 'text' },
]);

const DEFAULT_SELECT =
  'e.id::text AS id, e.timestamp AS timestamp, e.level AS level, e.service AS service, ' +
  'e.host AS host, e.source AS source, e.message AS message, e.attributes AS attributes';

function assertContext(ctx: CompileContext): void {
  if (!UUID_RE.test(ctx.organizationId)) throw new Error('organizationId must be a UUID');
  if (!Number.isInteger(ctx.maxRows) || ctx.maxRows < 1)
    throw new Error('maxRows must be a positive integer');
}

/** Tenant + time predicate that every compiled statement starts with (enables partition pruning). */
function basePredicate(ctx: CompileContext, range: TimeRange): SqlFragment {
  return sql(
    'e.organization_id = $?::uuid AND e.timestamp >= $?::timestamptz AND e.timestamp < $?::timestamptz',
    [ctx.organizationId, range.from.toISOString(), range.to.toISOString()],
  );
}

function whereClause(plan: QueryPlan, ctx: CompileContext, range: TimeRange): SqlFragment {
  const filters = plan.filters.map((f) => compileExpr(f, { now: ctx.now }));
  return joinSql([basePredicate(ctx, range), ...filters], ' AND ');
}

function eventOrder(sort: readonly SortKey[] | null): SqlFragment {
  if (!sort) return sql('e.timestamp DESC, e.id DESC');
  const keys = sort.map((k) => {
    const field = resolveField({ name: k.name, span: k.span });
    const dir = k.descending ? 'DESC' : 'ASC';
    const expr = field.kind === 'column' ? sql(field.column) : textExpr(field);
    return composeSql(`{} ${dir} NULLS LAST`, expr);
  });
  return joinSql([...keys, sql('e.id DESC')], ', ');
}

function projection(plan: QueryPlan): { select: SqlFragment; columns: readonly OutputColumn[] } {
  if (!plan.projection) return { select: sql(DEFAULT_SELECT), columns: EVENT_COLUMNS };
  const fields = plan.projection.map((ref, i) => {
    const field = resolveField(ref);
    const type =
      field.kind === 'column' && field.type === 'time' ? ('time' as const) : ('text' as const);
    const expr = field.kind === 'column' ? sql(field.column) : textExpr(field);
    return { key: `f${i}`, name: ref.name, type, expr };
  });
  return {
    select: joinSql(
      [
        sql('e.id::text AS id, e.timestamp AS timestamp'),
        ...fields.map((f) => composeSql(`{} AS ${f.key}`, f.expr)),
      ],
      ', ',
    ),
    columns: [
      EVENT_COLUMNS[0] as OutputColumn,
      EVENT_COLUMNS[1] as OutputColumn,
      ...fields.map(({ key, name, type }) => ({ key, name, type })),
    ],
  };
}

function compileEvents(plan: QueryPlan, ctx: CompileContext, range: TimeRange): CompiledQuery {
  const limit = Math.min(plan.eventLimit ?? ctx.defaultLimit, ctx.maxRows);
  const { select, columns } = projection(plan);
  const statement = composeSql(
    'SELECT {} FROM log_events e WHERE {} ORDER BY {} LIMIT {}',
    select,
    whereClause(plan, ctx, range),
    eventOrder(plan.eventSort),
    sql('$?::int', [limit]),
  );
  return { ...finalizeSql(statement), mode: 'events', columns, range, limit };
}

function compileTable(plan: QueryPlan, ctx: CompileContext, range: TimeRange): CompiledQuery {
  const stats = plan.stats as NonNullable<QueryPlan['stats']>;
  assertBucketBudget(stats, range);
  const { select, groupBy, columns } = compileStatsSelect(stats);
  const inner = groupBy
    ? composeSql(
        'SELECT {} FROM log_events e WHERE {} GROUP BY {}',
        select,
        whereClause(plan, ctx, range),
        groupBy,
      )
    : composeSql('SELECT {} FROM log_events e WHERE {}', select, whereClause(plan, ctx, range));
  const post = plan.postFilters.map((f) => compilePostExpr(f, columns));
  const limit = Math.min(plan.postLimit ?? ctx.maxRows, ctx.maxRows);
  const outerWhere = post.length > 0 ? composeSql(' WHERE {}', joinSql(post, ' AND ')) : sql('');
  const statement = composeSql(
    'SELECT * FROM ({}) t{} ORDER BY {} LIMIT {}',
    inner,
    outerWhere,
    compilePostOrder(plan.postSort, columns),
    sql('$?::int', [limit]),
  );
  return { ...finalizeSql(statement), mode: 'table', columns, range, limit };
}

/** Parses (if needed), validates and compiles a LensQL query into one parameterized statement. */
export function compileQuery(query: string | QueryAst, ctx: CompileContext): CompiledQuery {
  assertContext(ctx);
  const ast = typeof query === 'string' ? parseQuery(query) : query;
  const plan = analyze(ast);
  const range = resolveTimeRange(ast, ctx.range, ctx.now);
  return plan.stats ? compileTable(plan, ctx, range) : compileEvents(plan, ctx, range);
}

/**
 * Compiles the event-count histogram for the search portion of a query (pre-stats filters only),
 * bucketed so the range yields at most `targetBuckets` bars.
 */
export function compileHistogram(
  query: string | QueryAst,
  ctx: CompileContext,
  targetBuckets = 60,
): CompiledHistogram {
  assertContext(ctx);
  if (!Number.isInteger(targetBuckets) || targetBuckets < 1 || targetBuckets > 500) {
    throw new LensQLError(
      'LIMIT_EXCEEDED',
      'targetBuckets must be between 1 and 500',
      spanOf(0, 0),
    );
  }
  const ast = typeof query === 'string' ? parseQuery(query) : query;
  const plan = analyze(ast);
  const range = resolveTimeRange(ast, ctx.range, ctx.now);
  const bucketSeconds = chooseBucketSeconds(range, targetBuckets);
  const statement = composeSql(
    'SELECT {} AS bucket, count(*)::float8 AS count FROM log_events e WHERE {} GROUP BY 1 ORDER BY 1',
    timeBucket(bucketSeconds),
    whereClause(plan, ctx, range),
  );
  return { ...finalizeSql(statement), bucketSeconds, range };
}
