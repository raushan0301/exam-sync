'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { FacultyAssignment } from './types';

export interface UseFacultyAssignmentsParams {
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for views that must show/count all rows. */
  all?: boolean;
}

/** GET /faculty/{id}/assignments — self or ADMIN. Paginated. */
export function useFacultyAssignments(facultyId: string | undefined, params: UseFacultyAssignmentsParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.facultyAssignments(facultyId ?? '', query),
    queryFn: () => fetchList<FacultyAssignment>(`/faculty/${facultyId}/assignments`, query),
    enabled: hasStoredSession() && !!facultyId,
    staleTime: 30_000,
  });
}
