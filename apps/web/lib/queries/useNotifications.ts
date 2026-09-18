'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { Notification, PaginatedResult } from './types';

export interface UseNotificationsParams {
  cursor?: string;
  limit?: number;
}

/**
 * GET /me/notifications — self-scoped to the caller, no role restriction
 * beyond being authenticated. The one data source genuinely available to
 * all three roles (ADMIN, FACULTY, STUDENT) for dashboard purposes.
 */
export function useNotifications(params: UseNotificationsParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.notifications(query),
    queryFn: () => apiFetch<PaginatedResult<Notification>>('/me/notifications', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
