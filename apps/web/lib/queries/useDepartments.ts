'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AcademicStatus, Department, PaginatedResult } from './types';

export interface UseDepartmentsParams {
  status?: AcademicStatus;
  search?: string;
  cursor?: string;
  limit?: number;
}

/** GET /departments — any authenticated user; ADMIN-only actions (create/update) gate at the mutation/page level. */
export function useDepartments(params: UseDepartmentsParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    search: params.search || undefined,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.departments(query),
    queryFn: () => apiFetch<PaginatedResult<Department>>('/departments', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
