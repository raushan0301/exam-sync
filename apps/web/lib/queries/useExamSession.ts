'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { ExamSessionDetail } from './types';

/**
 * GET /exam-sessions/{id} — scoped (ADMIN sees any session; FACULTY sees
 * a session iff they own at least one of its currently-attached quizzes —
 * verified against exam-sessions-access.repository.ts). Includes the
 * nested `quizzes` and `rooms` arrays (see `ExamSessionDetail`).
 */
export function useExamSession(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.examSession(id ?? ''),
    queryFn: () => apiFetch<ExamSessionDetail>(`/exam-sessions/${id}`),
    enabled: hasStoredSession() && !!id,
    staleTime: 10_000,
  });
}
