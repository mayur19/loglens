import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly organization: { readonly id: string; readonly name: string };
  readonly role: string;
  readonly permissions: readonly string[];
}

export interface AuthState {
  readonly user: CurrentUser | null;
  readonly loading: boolean;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<CurrentUser>('/api/v1/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ user: CurrentUser }>('/api/v1/auth/login', { email, password });
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/v1/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
