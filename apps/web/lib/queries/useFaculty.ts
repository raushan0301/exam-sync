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

/** GET /faculty — ADMIN or FACULTY (used by InvigilatorPanel's "Assign Invigilator" picker). Supports search (faculty.controller.ts). */
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

/**
 * GET /faculty/me — resolves the calling FACULTY's own Faculty row.
 * `GET /users/me` has a fixed, documented shape with no `facultyId`, so
 * this is the only way pages like "My Invigilation Duties"/"My
 * Assignments" can learn their own faculty id to call their own
 * faculty-scoped GETs. 404s for a non-faculty actor.
 */
export function useMyFaculty() {
  return useQuery({
    queryKey: ['faculty', 'me'] as const,
    queryFn: () => apiFetch<Faculty>('/faculty/me'),
    enabled: hasStoredSession(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
