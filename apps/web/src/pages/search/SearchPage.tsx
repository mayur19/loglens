import { TIME_PRESETS } from '@loglens/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { Histogram } from './Histogram';
import { QueryError, type QueryErrorInfo } from './QueryError';
import { ResultsTable } from './ResultsTable';
import { runHistogram, runSearch, type HistogramResponse, type SearchResponse } from './search.api';

const EXAMPLES = [
  'level=error',
  'service=checkout http.status>=500',
  '"timeout" OR "connection reset" | stats count() by service',
  '| stats count() by level span=5m',
  'service=api-gateway | stats avg(latency_ms) as avg_ms, p95(latency_ms) by http.path | sort -avg_ms | head 5',
];

const rangeFor = (presetId: string, now = Date.now()) => {
  const preset = TIME_PRESETS.find((p) => p.id === presetId) ?? TIME_PRESETS[1];
  return {
    from: new Date(now - preset.seconds * 1000).toISOString(),
    to: new Date(now).toISOString(),
  };
};

const toErrorInfo = (err: unknown): QueryErrorInfo => {
  if (err instanceof ApiError) {
    const details = err.details as { span?: { start: number; end: number } } | undefined;
    return details?.span ? { message: err.message, span: details.span } : { message: err.message };
  }
  return { message: 'Search failed' };
};

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [preset, setPreset] = useState('24h');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [hist, setHist] = useState<HistogramResponse | null>(null);
  const [error, setError] = useState<QueryErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const execute = useCallback(async (q: string, presetId: string) => {
    setBusy(true);
    setError(null);
    setSubmitted(q);
    const params = { query: q, ...rangeFor(presetId) };
    try {
      const [r, h] = await Promise.all([runSearch(params), runHistogram(params)]);
      setResult(r);
      setHist(h);
    } catch (err) {
      setError(toErrorInfo(err));
      setResult(null);
      setHist(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void execute('', '24h');
  }, [execute]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void execute(query, preset);
  };

  return (
    <section className="page">
      <header className="page-header">
        <h1>Search</h1>
        <span className="muted small">
          LensQL · filters, boolean logic, regex, | stats · sort · head · fields · where
        </span>
      </header>
      <form className="query-bar" onSubmit={onSubmit}>
        <input
          aria-label="LensQL query"
          className="query-input mono"
          placeholder="e.g. level=error service=checkout | stats count() by host"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <select aria-label="Time range" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {TIME_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Running…' : 'Run'}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip mono"
            onClick={() => {
              setQuery(ex);
              void execute(ex, preset);
            }}
          >
            {ex}
          </button>
        ))}
      </div>
      {error && <QueryError query={submitted} error={error} />}
      {hist && (
        <div className="card">
          <div className="card-header">
            <strong>{hist.total.toLocaleString()} events</strong>
            <span className="muted small">bucket {hist.bucketSeconds}s</span>
          </div>
          <Histogram buckets={hist.buckets} bucketSeconds={hist.bucketSeconds} />
        </div>
      )}
      {result && (
        <div className="card">
          <div className="card-header">
            <strong>{result.mode === 'table' ? 'Statistics' : 'Events'}</strong>
            <span className="muted small">
              {result.stats.rowCount} rows
              {result.stats.truncated ? ` (limit ${result.stats.limit})` : ''} ·{' '}
              {result.stats.elapsedMs} ms
            </span>
          </div>
          <ResultsTable columns={result.columns} rows={result.rows} />
        </div>
      )}
    </section>
  );
}
