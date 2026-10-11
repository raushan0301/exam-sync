'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { Invigilator, InvigilatorDuty } from './types';

export interface UseInvigilationDutiesParams {
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for views that must show/count all rows. */
  all?: boolean;
}

/**
 * GET /faculty/{id}/invigilation-duties — self (the calling faculty's own
 * duties) or ADMIN, verified against `InvigilationService.listDuties`.
 * Returns `InvigilatorDuty` rows (session name/schedule + room label
 * denormalized onto each one — see that type's own comment for why).
 *
 * `facultyId` is REQUIRED as a path param even for the "self" case — the
 * backend resolves "is this really you" via `facultyService.findByUserId`
 * server-side, but the URL itself still needs the Faculty row's id, not
 * the caller's User id. Resolve it first via `useMyFaculty` (`GET
 * /faculty/me`); callers pass `facultyId: undefined` while that's still
 * loading/unavailable, which disables this query.
 */
export function useInvigilationDuties(facultyId: string | undefined, params: UseInvigilationDutiesParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.invigilationDuties(facultyId ?? '', query),
    queryFn: () => fetchList<InvigilatorDuty>(`/faculty/${facultyId}/invigilation-duties`, query),
    enabled: hasStoredSession() && !!facultyId,
    staleTime: 30_000,
  });
}

/**
 * GET /exam-sessions/{id}/invigilators — ADMIN (unscoped) or the
 * owning/co-instructing FACULTY (scoped, 404 otherwise). Lets
 * `InvigilatorPanel` recover its "current assignments" list across a page
 * reload — it previously tracked assignments in local component state
 * only, since this endpoint didn't exist yet.
 */
export function useSessionInvigilators(examSessionId: string, params: UseInvigilationDutiesParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.sessionInvigilators(examSessionId, query),
    queryFn: () => fetchList<Invigilator>(`/exam-sessions/${examSessionId}/invigilators`, query),
    enabled: hasStoredSession() && !!examSessionId,
    staleTime: 10_000,
  });
}
