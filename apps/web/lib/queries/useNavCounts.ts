'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';

export type NavCounts = Record<string, number>;

/**
 * GET /me/nav-counts — the red numbers beside sidebar items. Shaped by the
 * server to the caller's role; a key that is absent simply has no badge.
 * Polled so a new assignment or approval request shows up without a reload.
 */
export function useNavCounts() {
  return useQuery({
    queryKey: queryKeys.navCounts,
    queryFn: async () => (await apiFetch<{ counts: NavCounts }>('/me/nav-counts')).counts,
    enabled: hasStoredSession(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
