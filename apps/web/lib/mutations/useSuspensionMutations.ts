'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { SuspensionRequest } from '../queries/types';

/** A request or review changes the request list, the affected session, and (on approval) every session list. */
function useInvalidateSuspensionData() {
  const queryClient = useQueryClient();
  return (examSessionId?: string) => {
    queryClient.invalidateQueries({ queryKey: ['suspension-requests'] });
    queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    if (examSessionId) queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
  };
}

/**
 * POST /exam-sessions/{id}/suspension-request — FACULTY (owner/co-instructor).
 * Replaces the old direct "cancel": nothing is cancelled until an admin approves.
 */
export function useRequestSuspension(examSessionId: string) {
  const invalidate = useInvalidateSuspensionData();
  return useMutation({
    mutationFn: (reason: string) =>
      apiFetch<SuspensionRequest>(`/exam-sessions/${examSessionId}/suspension-request`, { method: 'POST', body: { reason } }),
    onSuccess: () => invalidate(examSessionId),
  });
}

/**
 * POST /suspension-requests/{id}/approve — ADMIN. Cancels the session (releasing
 * its quizzes, rooms, invigilators and seating plans, and notifying students)
 * and moves it to History. 409s if the session has since started or finished.
 */
export function useApproveSuspension() {
  const invalidate = useInvalidateSuspensionData();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiFetch<SuspensionRequest>(`/suspension-requests/${id}/approve`, { method: 'POST', body: note ? { note } : {} }),
    onSuccess: (request) => invalidate(request.examSessionId),
  });
}

/** POST /suspension-requests/{id}/reject — ADMIN. A reason is required; the session is left untouched. */
export function useRejectSuspension() {
  const invalidate = useInvalidateSuspensionData();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      apiFetch<SuspensionRequest>(`/suspension-requests/${id}/reject`, { method: 'POST', body: { note } }),
    onSuccess: (request) => invalidate(request.examSessionId),
  });
}
