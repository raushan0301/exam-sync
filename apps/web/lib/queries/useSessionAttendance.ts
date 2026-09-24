'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AttendanceOverviewRow, PaginatedResult } from './types';

export interface UseSessionAttendanceParams {
  cursor?: string;
  limit?: number;
}

/**
 * GET /exam-sessions/{id}/attendance — ADMIN sees every row; FACULTY sees
 * only rows whose seat is in a room they invigilate for this session
 * (self-scoped server-side, no client filter needed — verified against
 * `AttendanceService.listForSession`). Returns `AttendanceOverviewRow`
 * (student name/roll number, quiz title, seat label denormalized onto
 * each row) — a strict superset of the base `Attendance` fields, so this
 * is safe for every existing consumer (e.g. `RoomAttendanceCard`'s
 * seat-keyed lookup, which only reads the base fields).
 */
export function useSessionAttendance(examSessionId: string | undefined, params: UseSessionAttendanceParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.sessionAttendance(examSessionId ?? '', query),
    queryFn: () => apiFetch<PaginatedResult<AttendanceOverviewRow>>(`/exam-sessions/${examSessionId}/attendance`, { query }),
    enabled: hasStoredSession() && !!examSessionId,
    staleTime: 10_000,
  });
}
