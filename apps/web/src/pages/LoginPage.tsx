import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/search" replace />;
  const update = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        const result = await api.post<{ message: string }>('/api/v1/auth/register', form);
        setNotice(result.message);
        setMode('login');
      } else {
        await login(form.email, form.password);
        const from = (location.state as { from?: string } | null)?.from ?? '/search';
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={(e) => void submit(e)}>
        <h1>
          <span className="brand-mark" aria-hidden="true">
            ◎
          </span>{' '}
          LogLens
        </h1>
        <p className="muted">
          {mode === 'login' ? 'Sign in to search your logs.' : 'Create a workspace for your team.'}
        </p>
        {notice && (
          <div className="alert alert-info" role="status">
            {notice}
          </div>
        )}
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {mode === 'register' && (
          <>
            <label>
              Organization
              <input
                value={form.organizationName}
                onChange={update('organizationName')}
                required
                minLength={2}
              />
            </label>
            <label>
              Your name
              <input value={form.name} onChange={update('name')} required />
            </label>
          </>
        )}
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={form.email}
            onChange={update('email')}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={form.password}
            onChange={update('password')}
            required
            minLength={mode === 'register' ? 12 : 1}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create workspace'}
        </button>
        <button
          type="button"
          className="btn btn-link"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'New here? Create a workspace' : 'Already have an account? Sign in'}
        </button>
        <p className="muted small">Demo: owner@acme.test / loglens-demo-password</p>
      </form>
    </div>
  );
}
