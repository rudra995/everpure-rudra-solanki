// Who is signed in, and what they may do. The permission list comes from the server
// (/api/auth/me), so the UI only mirrors the server's decision: hiding a button here is
// convenience, the API still returns 403 if someone calls it directly.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Restore the session from a saved token on page load.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return setReady(true);
    api.get('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true));
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const { token, user: profile } = await api.post('/api/auth/login', { email, password });
    tokenStore.set(token);
    setUser(profile);
  }, []);

  const value = useMemo(() => ({
    user,
    ready,
    login,
    logout,
    // can('cost:read:all') or can(['cost:read:all', 'cost:read:own']) = any of them
    can: (perm) => {
      const list = user?.permissions ?? [];
      return Array.isArray(perm) ? perm.some((p) => list.includes(p)) : list.includes(perm);
    },
  }), [user, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// Permission names, mirrored from backend/src/rbac/permissions.js.
export const P = {
  HEALTH_READ: 'health:read',
  REPORTS_READ_ALL: 'reports:read:all',
  COST_READ_ALL: 'cost:read:all',
  COST_READ_OWN: 'cost:read:own',
  PII_READ: 'pii:read',
  ORPHANED_READ: 'orphaned:read',
  ORPHANED_CLAIM: 'orphaned:claim',
  ORPHANED_APPROVE: 'orphaned:approve',
  ALERTS_READ_ALL: 'alerts:read:all',
  ALERTS_READ_OWN: 'alerts:read:own',
  ALERTS_ACK_ALL: 'alerts:ack:all',
  ALERTS_ACK_OWN: 'alerts:ack:own',
  DQ_READ_SUMMARY: 'dq:read:summary',
  DQ_READ_ISSUES: 'dq:read:issues',
  AUDIT_READ: 'audit:read',
  SIMULATOR_CONTROL: 'simulator:control',
};
