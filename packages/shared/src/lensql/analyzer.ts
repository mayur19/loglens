import type { Command, Expr, FieldRef, QueryAst, SortKey } from './ast.js';
import { LensQLError, type Span } from './errors.js';

export type StatsCommand = Extract<Command, { kind: 'stats' }>;

/** A validated, stage-separated view of a query: what to filter, aggregate, sort and cap. */
export interface QueryPlan {
  readonly filters: readonly Expr[];
  readonly projection: readonly FieldRef[] | null;
  readonly eventSort: readonly SortKey[] | null;
  readonly eventLimit: number | null;
  readonly stats: StatsCommand | null;
  readonly postFilters: readonly Expr[];
  readonly postSort: readonly SortKey[] | null;
  readonly postLimit: number | null;
}

interface StageState {
  readonly filters: readonly Expr[];
  readonly projection: readonly FieldRef[] | null;
  readonly sort: readonly SortKey[] | null;
  readonly limit: number | null;
}

const EMPTY_STAGE: StageState = { filters: [], projection: null, sort: null, limit: null };

const fail = (message: string, span: Span): never => {
  throw new LensQLError('SEMANTIC_ERROR', message, span);
};

function applyCommand(stage: StageState, command: Command, afterStats: boolean): StageState {
  if (stage.limit !== null) {
    return fail(
      `'${command.kind}' cannot follow head; head must be the last command of its stage`,
      command.span,
    );
  }
  switch (command.kind) {
    case 'where':
      if (stage.sort !== null) return fail('where must come before sort', command.span);
      return { ...stage, filters: [...stage.filters, command.expr] };
    case 'fields':
      if (afterStats) return fail('fields cannot be used after stats', command.span);
      if (stage.projection !== null) return fail('fields may only appear once', command.span);
      return { ...stage, projection: command.fields };
    case 'sort':
      if (stage.sort !== null) return fail('sort may only appear once per stage', command.span);
      return { ...stage, sort: command.keys };
    case 'head':
      return { ...stage, limit: command.count };
    case 'stats':
      return fail('stats may only appear once', command.span);
  }
}

/** Splits the pipeline into the pre-aggregation and post-aggregation stages and validates ordering. */
export function analyze(ast: QueryAst): QueryPlan {
  const statsIndex = ast.commands.findIndex((c) => c.kind === 'stats');
  const before = statsIndex === -1 ? ast.commands : ast.commands.slice(0, statsIndex);
  const after = statsIndex === -1 ? [] : ast.commands.slice(statsIndex + 1);
  const stats = statsIndex === -1 ? null : (ast.commands[statsIndex] as StatsCommand);

  const pre = before.reduce((s, c) => applyCommand(s, c, false), EMPTY_STAGE);
  if (stats && pre.limit !== null) {
    fail(
      'stats after head would aggregate a truncated result; remove head or move it after stats',
      stats.span,
    );
  }
  if (stats && (pre.sort !== null || pre.projection !== null)) {
    fail('sort and fields before stats have no effect; move them after stats', stats.span);
  }
  const post = after.reduce((s, c) => applyCommand(s, c, true), EMPTY_STAGE);
  const filters = ast.search ? [ast.search, ...pre.filters] : pre.filters;

  return {
    filters,
    projection: pre.projection,
    eventSort: pre.sort,
    eventLimit: pre.limit,
    stats,
    postFilters: post.filters,
    postSort: post.sort,
    postLimit: post.limit,
  };
}
