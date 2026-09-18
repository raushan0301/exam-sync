'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { PaginatedResult, QuizStudentAssignmentStatus, RosterEntry } from './types';

export interface UseExamSessionRosterParams {
  status?: QuizStudentAssignmentStatus;
  cursor?: string;
  limit?: number;
}

/** GET /exam-sessions/{id}/roster — ADMIN, FACULTY. Paginated, status-filterable. */
export function useExamSessionRoster(examSessionId: string | undefined, params: UseExamSessionRosterParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.examSessionRoster(examSessionId ?? '', query),
    queryFn: () => apiFetch<PaginatedResult<RosterEntry>>(`/exam-sessions/${examSessionId}/roster`, { query }),
    enabled: hasStoredSession() && !!examSessionId,
    staleTime: 10_000,
  });
}
