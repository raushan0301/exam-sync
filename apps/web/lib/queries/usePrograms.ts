'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { AcademicStatus, Program } from './types';

export interface UseProgramsParams {
  status?: AcademicStatus;
  search?: string;
  departmentId?: string;
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for pick-lists that must show all rows. */
  all?: boolean;
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
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.programs(query),
    queryFn: () => fetchList<Program>('/programs', query),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
