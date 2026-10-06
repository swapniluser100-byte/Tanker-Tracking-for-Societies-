import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api } from './api';
import type { Role } from '../../shared/roles';
import { FullPageSpinner } from '../components/ui';

export interface Me {
  id: number;
  name: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  role: Role;
  flatId: number | null;
  flat: string | null;
  mustResetPassword: boolean;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api<{ user: Me | null }>('/auth/me');
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setUser(null);
      // Shared family phones: don't leave the last resident's cached data behind.
      if ('caches' in window) void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauth = () => setUser(null);
    const onReset = () => void refresh();
    window.addEventListener('jalsetu:unauthenticated', onUnauth);
    window.addEventListener('jalsetu:must-reset', onReset);
    return () => {
      window.removeEventListener('jalsetu:unauthenticated', onUnauth);
      window.removeEventListener('jalsetu:must-reset', onReset);
    };
  }, [refresh]);

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Route guard. The API enforces roles too — this only decides what to render. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.mustResetPassword && location.pathname !== '/account') return <Navigate to="/account" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
