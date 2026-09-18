'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AttendanceWithHistory, PaginatedResult } from './types';

export interface UseStudentAttendanceHistoryParams {
  cursor?: string;
  limit?: number;
}

/**
 * GET /students/{id}/attendance-history — self (the student's own history)
 * or ADMIN, verified against `AttendanceService.getHistoryForStudent`.
 *
 * Same self-ID-resolution gap as `useInvigilationDuties`: `GET /users/me`
 * carries no `studentId`, so a logged-in STUDENT cannot construct this
 * URL for themselves — the exact gap `app/student/dashboard/page.tsx`
 * already documented in M3. This hook is therefore usable only from an
 * ADMIN context that already knows the target `studentId` (e.g. a
 * student detail view); pass `studentId: undefined` to disable it
 * otherwise.
 */
export function useStudentAttendanceHistory(studentId: string | undefined, params: UseStudentAttendanceHistoryParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.studentAttendanceHistory(studentId ?? '', query),
    queryFn: () => apiFetch<PaginatedResult<AttendanceWithHistory>>(`/students/${studentId}/attendance-history`, { query }),
    enabled: hasStoredSession() && !!studentId,
    staleTime: 30_000,
  });
}
