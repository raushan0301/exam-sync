'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { FacultyAssignment, PaginatedResult } from './types';

export interface UseFacultyAssignmentsParams {
  cursor?: string;
  limit?: number;
}

/** GET /faculty/{id}/assignments — self or ADMIN. Paginated. */
export function useFacultyAssignments(facultyId: string | undefined, params: UseFacultyAssignmentsParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.facultyAssignments(facultyId ?? '', query),
    queryFn: () => apiFetch<PaginatedResult<FacultyAssignment>>(`/faculty/${facultyId}/assignments`, { query }),
    enabled: hasStoredSession() && !!facultyId,
    staleTime: 30_000,
  });
}
