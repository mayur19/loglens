import type { Span } from './errors.js';

export type CompareOp = '=' | '!=' | '>' | '>=' | '<' | '<=';

export interface FieldRef {
  readonly name: string;
  readonly span: Span;
}

export type Literal =
  | { readonly kind: 'string'; readonly value: string; readonly span: Span }
  | { readonly kind: 'number'; readonly value: string; readonly span: Span }
  | { readonly kind: 'wildcard'; readonly value: string; readonly span: Span };

export type Expr =
  | { readonly kind: 'and'; readonly left: Expr; readonly right: Expr; readonly span: Span }
  | { readonly kind: 'or'; readonly left: Expr; readonly right: Expr; readonly span: Span }
  | { readonly kind: 'not'; readonly expr: Expr; readonly span: Span }
  | {
      readonly kind: 'compare';
      readonly field: FieldRef;
      readonly op: CompareOp;
      readonly value: Literal;
      readonly span: Span;
    }
  | {
      readonly kind: 'regex';
      readonly field: FieldRef;
      readonly negate: boolean;
      readonly pattern: string;
      readonly span: Span;
    }
  | {
      readonly kind: 'in';
      readonly field: FieldRef;
      readonly values: readonly Literal[];
      readonly span: Span;
    }
  | { readonly kind: 'exists'; readonly field: FieldRef; readonly span: Span }
  | { readonly kind: 'text'; readonly value: Literal; readonly span: Span };

export const AGGREGATE_FUNCTIONS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'dc',
  'p50',
  'p90',
  'p95',
  'p99',
] as const;
export type AggregateFn = (typeof AGGREGATE_FUNCTIONS)[number];

export interface Aggregation {
  readonly fn: AggregateFn;
  readonly field: FieldRef | null;
  /** Display name of the output column (explicit `as` alias or derived, e.g. `avg(latency)`). */
  readonly name: string;
  readonly span: Span;
}

export interface SortKey {
  readonly name: string;
  readonly descending: boolean;
  readonly span: Span;
}

export type Command =
  | {
      readonly kind: 'stats';
      readonly aggregations: readonly Aggregation[];
      readonly groupBy: readonly FieldRef[];
      readonly spanSeconds: number | null;
      readonly span: Span;
    }
  | { readonly kind: 'sort'; readonly keys: readonly SortKey[]; readonly span: Span }
  | { readonly kind: 'head'; readonly count: number; readonly span: Span }
  | { readonly kind: 'fields'; readonly fields: readonly FieldRef[]; readonly span: Span }
  | { readonly kind: 'where'; readonly expr: Expr; readonly span: Span };

export interface TimeBound {
  readonly value: string;
  readonly span: Span;
}

export interface QueryAst {
  readonly search: Expr | null;
  readonly earliest: TimeBound | null;
  readonly latest: TimeBound | null;
  readonly commands: readonly Command[];
}
