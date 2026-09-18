'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useCurrentUser, type CurrentUser } from '../queries/useCurrentUser';
import { hasStoredSession, onAuthChange } from '../token-storage';

export type { CurrentUser };

interface IdentityContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /**
   * Frontend-only convenience derived from `roles[]` — the backend has no
   * concept of a "primary" role, a user can hold several. Precedence:
   * ADMIN > FACULTY > STUDENT > roles[0] (first role returned, for any
   * other/future role name).
   */
  primaryRole: string | null;
  refetch: () => void;
}

const IdentityContext = createContext<IdentityContextValue | undefined>(undefined);

function derivePrimaryRole(roles: string[]): string | null {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('FACULTY')) return 'FACULTY';
  if (roles.includes('STUDENT')) return 'STUDENT';
  return roles[0] ?? null;
}

/**
 * The ONE place identity is fetched app-wide (GET /users/me, via
 * useCurrentUser). Wraps the whole app in root layout.tsx so every route —
 * including /login and /design-system — can read `useIdentity()`.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  // Avoids an SSR/client hasStoredSession() mismatch: localStorage doesn't
  // exist on the server, so we only start the query after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Bumped whenever token-storage fires an auth-change event (login,
  // logout, or a failed-refresh redirect clearing tokens), so this
  // component re-renders and re-evaluates `hasSession` below — otherwise
  // a token appearing after mount would leave the already-disabled query
  // observer with no reason to ever flip to enabled.
  const [authChangeTick, setAuthChangeTick] = useState(0);
  useEffect(() => onAuthChange(() => setAuthChangeTick((t) => t + 1)), []);

  const hasSession = mounted && hasStoredSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const query = useCurrentUser(hasSession);
  void authChangeTick;

  const value = useMemo<IdentityContextValue>(() => {
    const roles = query.data?.roles ?? [];
    return {
      user: query.data ?? null,
      isLoading: hasSession && (query.isLoading || query.isFetching) && !query.data && !query.isError,
      isAuthenticated: !!query.data,
      primaryRole: query.data ? derivePrimaryRole(roles) : null,
      refetch: () => {
        query.refetch();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, query.isLoading, query.isFetching, query.isError, hasSession]);

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used within IdentityProvider');
  return ctx;
}
