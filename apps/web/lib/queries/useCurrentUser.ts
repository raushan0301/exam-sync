'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';

/**
 * GET /users/me — response is EXACTLY
 * { id, email, isActive, roles, mustChangePassword, createdAt }.
 * There is no "name" field on this backend; UI that needs to display an
 * identity falls back to `email` (see components/shell/AppShell.tsx).
 */
export interface CurrentUser {
  id: string;
  email: string;
  isActive: boolean;
  roles: string[];
  mustChangePassword: boolean;
  createdAt: string;
}

/**
 * The ONE place GET /users/me is fetched from. Every other consumer goes
 * through IdentityProvider/useIdentity, never calls this (or the endpoint)
 * directly.
 */
export function useCurrentUser(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: () => apiFetch<CurrentUser>('/users/me'),
    enabled: enabled && hasStoredSession(),
    retry: false,
    staleTime: 5 * 60_000,
  });
}
