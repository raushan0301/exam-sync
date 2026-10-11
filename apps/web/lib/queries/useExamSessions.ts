'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { ExamSession } from './types';

export interface UseExamSessionsParams {
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for pick-lists that must show all rows. */
  all?: boolean;
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
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.examSessions(query),
    queryFn: () => fetchList<ExamSession>('/exam-sessions', query),
    enabled: hasStoredSession(),
  });
}
