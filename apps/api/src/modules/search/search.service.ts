import {
  compileHistogram,
  compileQuery,
  ERROR_CODES,
  fillHistogram,
  LensQLError,
  parseQuery,
  type CompileContext,
  type HistogramBucket,
  type OutputColumn,
} from '@loglens/shared';
import type { Db } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';

export interface SearchDeps {
  readonly db: Db;
  readonly timeoutMs: number;
  readonly maxRows: number;
  readonly now: () => Date;
}

export interface SearchInput {
  readonly organizationId: string;
  readonly query: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

const DEFAULT_WINDOW_MS = 3_600_000;
const DEFAULT_EVENT_LIMIT = 100;

export function contextFor(deps: SearchDeps, input: SearchInput): CompileContext {
  const now = deps.now();
  const to = input.to ? new Date(input.to) : now;
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - DEFAULT_WINDOW_MS);
  return {
    organizationId: input.organizationId,
    range: { from, to },
    now,
    defaultLimit: input.limit ?? DEFAULT_EVENT_LIMIT,
    maxRows: deps.maxRows,
  };
}

export const queryInvalid = (err: LensQLError): AppError =>
  new AppError(422, ERROR_CODES.QUERY_INVALID, err.message, {
    lensqlCode: err.code,
    span: err.span,
  });

/** Translates compile errors to 422 and database failures (timeouts, bad regex) to stable codes. */
function translate(err: unknown): never {
  if (err instanceof LensQLError) throw queryInvalid(err);
  const code = (err as { code?: string }).code;
  if (code === '57014') {
    throw new AppError(
      422,
      ERROR_CODES.QUERY_TIMEOUT,
      'The query took too long; narrow the time range or add filters',
    );
  }
  if (code === '2201B' || code === '22P02' || code === '22023') {
    throw new AppError(
      422,
      ERROR_CODES.QUERY_FAILED,
      `The query could not be executed: ${(err as Error).message}`,
    );
  }
  throw err;
}

/**
 * Executes a compiled statement inside a READ ONLY transaction with a local statement timeout,
 * so even a pathological query cannot write or run unbounded.
 */
async function runReadOnly<T extends object>(
  deps: SearchDeps,
  text: string,
  values: readonly unknown[],
): Promise<T[]> {
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
      String(deps.timeoutMs),
    ]);
    const { rows } = await client.query<T>(text, values as unknown[]);
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return translate(err);
  } finally {
    client.release();
  }
}

const formatCell = (value: unknown, type: OutputColumn['type']): unknown => {
  if (value === null || value === undefined) return null;
  if (type === 'time') return value instanceof Date ? value.toISOString() : String(value);
  if (type === 'number') return Number(value);
  return value;
};

export interface SearchResult {
  readonly mode: 'events' | 'table';
  readonly columns: readonly { name: string; type: OutputColumn['type'] }[];
  readonly rows: readonly Record<string, unknown>[];
  readonly range: { readonly from: string; readonly to: string };
  readonly stats: {
    readonly rowCount: number;
    readonly limit: number;
    readonly truncated: boolean;
    readonly elapsedMs: number;
  };
}

export async function search(deps: SearchDeps, input: SearchInput): Promise<SearchResult> {
  const started = performance.now();
  let compiled;
  try {
    compiled = compileQuery(input.query, contextFor(deps, input));
  } catch (err) {
    return translate(err);
  }
  const raw = await runReadOnly<Record<string, unknown>>(deps, compiled.text, compiled.values);
  const rows = raw.map((row) =>
    Object.fromEntries(compiled.columns.map((c) => [c.name, formatCell(row[c.key], c.type)])),
  );
  return {
    mode: compiled.mode,
    columns: compiled.columns.map(({ name, type }) => ({ name, type })),
    rows,
    range: { from: compiled.range.from.toISOString(), to: compiled.range.to.toISOString() },
    stats: {
      rowCount: rows.length,
      limit: compiled.limit,
      truncated: rows.length >= compiled.limit,
      elapsedMs: Math.round(performance.now() - started),
    },
  };
}

export interface HistogramResult {
  readonly bucketSeconds: number;
  readonly buckets: readonly HistogramBucket[];
  readonly total: number;
  readonly range: { readonly from: string; readonly to: string };
}

export async function histogram(
  deps: SearchDeps,
  input: SearchInput & { buckets?: number },
): Promise<HistogramResult> {
  let compiled;
  try {
    compiled = compileHistogram(input.query, contextFor(deps, input), input.buckets ?? 60);
  } catch (err) {
    return translate(err);
  }
  const rows = await runReadOnly<{ bucket: Date; count: number }>(
    deps,
    compiled.text,
    compiled.values,
  );
  const buckets = fillHistogram(rows, compiled.range, compiled.bucketSeconds);
  return {
    bucketSeconds: compiled.bucketSeconds,
    buckets,
    total: buckets.reduce((sum, b) => sum + b.count, 0),
    range: { from: compiled.range.from.toISOString(), to: compiled.range.to.toISOString() },
  };
}

export type ValidationResult =
  | {
      readonly valid: true;
      readonly mode: 'events' | 'table';
      readonly commands: readonly string[];
    }
  | { readonly valid: false; readonly error: ReturnType<LensQLError['toJSON']> };

/** Parse + analyse without touching the database (powers as-you-type feedback in the editor). */
export function validate(
  deps: SearchDeps,
  organizationId: string,
  query: string,
): ValidationResult {
  try {
    const ast = parseQuery(query);
    const compiled = compileQuery(ast, contextFor(deps, { organizationId, query }));
    return { valid: true, mode: compiled.mode, commands: ast.commands.map((c) => c.kind) };
  } catch (err) {
    if (err instanceof LensQLError) return { valid: false, error: err.toJSON() };
    throw err;
  }
}
