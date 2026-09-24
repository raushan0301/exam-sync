'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { ExamSession, PaginatedResult } from './types';

export interface UseExamSessionsParams {
  cursor?: string;
  limit?: number;
}

/**
 * `GET /exam-sessions` — added by the faculty-lifecycle-ownership change.
 * ADMIN sees every session, unscoped (backs the new admin read-only "all
 * scheduled sessions" dashboard); FACULTY sees only sessions where they
 * own/co-instruct at least one currently actively-attached quiz (backs
 * the new "My Exam Sessions" faculty list).
 */
export function useExamSessions(params: UseExamSessionsParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.examSessions(query),
    queryFn: () => apiFetch<PaginatedResult<ExamSession>>('/exam-sessions', { query }),
    enabled: hasStoredSession(),
  });
}
