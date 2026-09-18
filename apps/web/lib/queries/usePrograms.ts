'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AcademicStatus, PaginatedResult, Program } from './types';

export interface UseProgramsParams {
  status?: AcademicStatus;
  search?: string;
  departmentId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * GET /programs — confirmed (programs.controller.ts) to accept the SAME
 * cursor/limit/search/status params as departments, plus `department_id`.
 */
export function usePrograms(params: UseProgramsParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    search: params.search || undefined,
    department_id: params.departmentId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.programs(query),
    queryFn: () => apiFetch<PaginatedResult<Program>>('/programs', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
