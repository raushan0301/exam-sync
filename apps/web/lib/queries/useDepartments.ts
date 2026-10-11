'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { AcademicStatus, Department } from './types';

export interface UseDepartmentsParams {
  status?: AcademicStatus;
  search?: string;
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for pick-lists that must show all rows. */
  all?: boolean;
}

/** GET /departments — any authenticated user; ADMIN-only actions (create/update) gate at the mutation/page level. */
export function useDepartments(params: UseDepartmentsParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    search: params.search || undefined,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.departments(query),
    queryFn: () => fetchList<Department>('/departments', query),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
