import { LensQLError } from './errors.js';
import type { FieldRef } from './ast.js';
import { sql, type SqlFragment } from './sql.js';

export type FieldType = 'time' | 'text' | 'json';

export type ResolvedField =
  | {
      readonly kind: 'column';
      readonly name: string;
      readonly column: string;
      readonly type: FieldType;
    }
  | { readonly kind: 'attribute'; readonly name: string; readonly path: readonly string[] };

/** Indexed first-class columns of log_events. Anything else is looked up in `attributes` (jsonb). */
const BUILTIN_COLUMNS: Readonly<
  Record<string, { column: string; type: FieldType; canonical: string }>
> = {
  timestamp: { column: 'e.timestamp', type: 'time', canonical: 'timestamp' },
  _time: { column: 'e.timestamp', type: 'time', canonical: 'timestamp' },
  level: { column: 'e.level', type: 'text', canonical: 'level' },
  service: { column: 'e.service', type: 'text', canonical: 'service' },
  host: { column: 'e.host', type: 'text', canonical: 'host' },
  source: { column: 'e.source', type: 'text', canonical: 'source' },
  message: { column: 'e.message', type: 'text', canonical: 'message' },
  msg: { column: 'e.message', type: 'text', canonical: 'message' },
  trace_id: { column: 'e.trace_id', type: 'text', canonical: 'trace_id' },
};

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;
const NUMERIC_TEXT_RE = '^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$';

export const BUILTIN_FIELD_NAMES = Object.freeze(
  Object.values(BUILTIN_COLUMNS)
    .map((c) => c.canonical)
    .filter((v, i, all) => all.indexOf(v) === i),
);

export function resolveField(ref: FieldRef): ResolvedField {
  if (!FIELD_RE.test(ref.name)) {
    throw new LensQLError('SEMANTIC_ERROR', `Invalid field name '${ref.name}'`, ref.span);
  }
  const builtin = BUILTIN_COLUMNS[ref.name.toLowerCase()];
  if (builtin) {
    return { kind: 'column', name: builtin.canonical, column: builtin.column, type: builtin.type };
  }
  const path = ref.name.startsWith('attributes.')
    ? ref.name.split('.').slice(1)
    : ref.name.split('.');
  return { kind: 'attribute', name: ref.name, path };
}

/** Text value of a field (column, or jsonb attribute extracted as text). */
export function textExpr(field: ResolvedField): SqlFragment {
  if (field.kind === 'column') {
    return sql(
      field.type === 'time'
        ? `to_char(${field.column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
        : field.column,
    );
  }
  return sql('(e.attributes #>> $?::text[])', [field.path]);
}

/**
 * Numeric value of an attribute, or NULL when it is missing / not numeric. Never raises a cast
 * error at execution time, so a single malformed event cannot fail a whole search.
 */
export function numericExpr(field: ResolvedField, ref: FieldRef): SqlFragment {
  if (field.kind === 'column') {
    throw new LensQLError('SEMANTIC_ERROR', `Field '${ref.name}' is not numeric`, ref.span);
  }
  const p = [field.path];
  return sql(
    `(CASE WHEN jsonb_typeof(e.attributes #> $?::text[]) = 'number' THEN (e.attributes #>> $?::text[])::numeric ` +
      `WHEN jsonb_typeof(e.attributes #> $?::text[]) = 'string' AND (e.attributes #>> $?::text[]) ~ '${NUMERIC_TEXT_RE}' ` +
      `THEN (e.attributes #>> $?::text[])::numeric END)`,
    [...p, ...p, ...p, ...p, ...p],
  );
}
