'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { PaginatedResult, Subject } from './types';

export interface UseSubjectsParams {
  /** Subjects use `is_active: boolean`, not a `status` enum (confirmed in subjects.controller.ts). */
  isActive?: boolean;
  search?: string;
  departmentId?: string;
  programId?: string;
  cursor?: string;
  limit?: number;
}

/** GET /subjects — confirmed query params: cursor, limit, search, isActive, department_id, program_id. */
export function useSubjects(params: UseSubjectsParams = {}) {
  const query: Record<string, string | undefined> = {
    isActive: params.isActive === undefined ? undefined : String(params.isActive),
    search: params.search || undefined,
    department_id: params.departmentId,
    program_id: params.programId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.subjects(query),
    queryFn: () => apiFetch<PaginatedResult<Subject>>('/subjects', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
