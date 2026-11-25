export interface QueryErrorInfo {
  readonly message: string;
  readonly span?: { readonly start: number; readonly end: number };
}

/** Shows a LensQL error with the offending part of the query underlined. */
export function QueryError({ query, error }: { query: string; error: QueryErrorInfo }) {
  const span = error.span;
  const hasSpan = span !== undefined && query.length > 0;
  const start = hasSpan ? Math.min(span.start, query.length) : 0;
  const end = hasSpan ? Math.max(start + 1, Math.min(span.end, query.length)) : 0;
  return (
    <div className="alert alert-error" role="alert">
      <div>{error.message}</div>
      {hasSpan && (
        <pre className="query-error">
          {query.slice(0, start)}
          <mark>{query.slice(start, end) || ' '}</mark>
          {query.slice(end)}
        </pre>
      )}
    </div>
  );
}
