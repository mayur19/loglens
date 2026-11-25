import type { ApiKeySummary } from '@loglens/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';

export function ApiKeysPage() {
  const { user } = useAuth();
  const canManage = user?.permissions.includes('ingest:keys:manage') ?? false;
  const [keys, setKeys] = useState<readonly ApiKeySummary[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<ApiKeySummary[]>('/api/v1/api-keys')
      .then(setKeys)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load keys'),
      );
  }, []);

  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await api.post<ApiKeySummary & { token: string }>('/api/v1/api-keys', {
        name,
      });
      setCreated(result.token);
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create key');
    }
  }

  async function revoke(id: string) {
    await api.del(`/api/v1/api-keys/${id}`).catch(() => undefined);
    load();
  }

  return (
    <section className="page">
      <header className="page-header">
        <h1>Ingestion keys</h1>
      </header>
      {error && <div className="alert alert-error">{error}</div>}
      {canManage && (
        <form className="card inline-form" onSubmit={(e) => void create(e)}>
          <input
            aria-label="Key name"
            placeholder="e.g. production shipper"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary">
            Create key
          </button>
        </form>
      )}
      {created && (
        <div className="alert alert-info">
          Copy this key now; it will not be shown again:
          <pre className="mono">{created}</pre>
          <pre className="mono small">{`curl -X POST http://localhost:4109/api/v1/ingest -H "Authorization: Bearer ${created}" -H "Content-Type: application/x-ndjson" --data-binary $'{"level":"error","service":"api","message":"boom"}'`}</pre>
        </div>
      )}
      <div className="card">
        <table className="results">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono">llk_{k.prefix}_…</td>
                <td>{k.createdAt.slice(0, 16).replace('T', ' ')}</td>
                <td>{k.lastUsedAt ? k.lastUsedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                <td>{k.revokedAt ? <span className="badge">Revoked</span> : 'Active'}</td>
                <td>
                  {canManage && !k.revokedAt && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void revoke(k.id)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
