'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { ExamSession } from '../queries/types';

/**
 * POST /exam-sessions/{id}/start — the owning/co-instructing FACULTY only
 * (404 otherwise, IDOR-safe), no body. Undocumented administrative
 * plumbing (not in API_CONTRACT.md) verified directly against
 * `ExamSessionLifecycleService.start`: only legal from
 * READY_FOR_FINALIZATION, and only once EVERY room allocated to the
 * session has a FINALIZED seating plan (409 otherwise, with
 * `details: [{type: 'SEATING_NOT_FINALIZED', roomId}]` for each room still
 * missing one).
 */
export function useStartExamSession(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<ExamSession>(`/exam-sessions/${examSessionId}/start`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
    },
  });
}

/**
 * POST /exam-sessions/{id}/complete — the owning/co-instructing FACULTY
 * only (404 otherwise, IDOR-safe), no body. Only legal from IN_PROGRESS
 * (409 otherwise). Side effect verified against
 * `ExamSessionLifecycleService.complete`: every `attendance` row for this
 * session gets `locked: true` in the same transaction — invalidating the
 * session-attendance list keeps the overview table's locked badges fresh.
 */
export function useCompleteExamSession(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<ExamSession>(`/exam-sessions/${examSessionId}/complete`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'attendance', examSessionId] });
    },
  });
}
