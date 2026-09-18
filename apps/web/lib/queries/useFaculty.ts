'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AcademicStatus, Faculty, PaginatedResult } from './types';

export interface UseFacultyParams {
  status?: AcademicStatus;
  search?: string;
  departmentId?: string;
  cursor?: string;
  limit?: number;
}

/** GET /faculty — ADMIN-only. Supports search (faculty.controller.ts). */
export function useFaculty(params: UseFacultyParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    search: params.search || undefined,
    department_id: params.departmentId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.faculty(query),
    queryFn: () => apiFetch<PaginatedResult<Faculty>>('/faculty', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
