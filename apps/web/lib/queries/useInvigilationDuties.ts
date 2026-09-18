'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { Invigilator, PaginatedResult } from './types';

export interface UseInvigilationDutiesParams {
  cursor?: string;
  limit?: number;
}

/**
 * GET /faculty/{id}/invigilation-duties — self (the calling faculty's own
 * duties) or ADMIN, verified against `InvigilationService.listDuties`.
 *
 * `facultyId` is REQUIRED as a path param even for the "self" case — the
 * backend resolves "is this really you" via `facultyService.findByUserId`
 * server-side, but the URL itself still needs the Faculty row's id, not
 * the caller's User id. `GET /users/me` (the only self-identity endpoint
 * on this backend) returns exactly `{id, email, isActive, roles,
 * createdAt}` — no `facultyId` — so this hook cannot resolve its own
 * `facultyId` from the current session. This is the SAME gap
 * `app/faculty/dashboard/page.tsx` already documented for M3 ("My
 * Assignments"/"My Invigilation Duties" omitted for the identical
 * reason). Callers pass `facultyId: undefined` when it is unknown, which
 * disables the query — the caller then renders an honest EmptyState
 * rather than attempting a request that has no valid URL to hit.
 */
export function useInvigilationDuties(facultyId: string | undefined, params: UseInvigilationDutiesParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.invigilationDuties(facultyId ?? '', query),
    queryFn: () => apiFetch<PaginatedResult<Invigilator>>(`/faculty/${facultyId}/invigilation-duties`, { query }),
    enabled: hasStoredSession() && !!facultyId,
    staleTime: 30_000,
  });
}
