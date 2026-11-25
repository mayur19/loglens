import type { SearchColumn } from './search.api';

const LEVEL_CLASS: Readonly<Record<string, string>> = {
  error: 'lvl-error',
  fatal: 'lvl-error',
  warn: 'lvl-warn',
  debug: 'lvl-debug',
  trace: 'lvl-debug',
};

export function formatCell(value: unknown, type: SearchColumn['type']): string {
  if (value === null || value === undefined) return '';
  if (type === 'number' && typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (type === 'time' && typeof value === 'string') return value.replace('T', ' ').replace('Z', '');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ResultsTable({
  columns,
  rows,
}: {
  columns: readonly SearchColumn[];
  rows: readonly Record<string, unknown>[];
}) {
  const visible = columns.filter((c) => c.name !== 'id');
  if (rows.length === 0) return <p className="muted">No results.</p>;
  return (
    <div className="table-wrap">
      <table className="results">
        <thead>
          <tr>
            {visible.map((c) => (
              <th key={c.name} className={c.type === 'number' ? 'num' : undefined}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {visible.map((c) => (
                <td
                  key={c.name}
                  className={
                    [
                      c.type === 'number' ? 'num' : '',
                      c.name === 'level' ? (LEVEL_CLASS[String(row[c.name])] ?? '') : '',
                      c.name === 'attributes' ? 'attrs' : '',
                    ]
                      .join(' ')
                      .trim() || undefined
                  }
                >
                  {formatCell(row[c.name], c.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
