'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { AssignStudentsResult, RosterEntry } from '../queries/types';

/**
 * POST /exam-sessions/{id}/assign-students — ADMIN only, no body. Despite
 * the `202` status, the backend runs this synchronously-but-chunked
 * (verified against student-assignment.service.ts's own header comment) —
 * the response already carries the final job status/counts, so this is
 * modeled as a plain one-shot mutation with no polling.
 */
export function useAssignStudents(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<AssignStudentsResult>(`/exam-sessions/${examSessionId}/assign-students`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'roster', examSessionId] });
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}

/** POST /exam-sessions/{id}/roster/{studentId} — ADMIN only. Manual add (late/waitlist, EC-015). */
export function useAddRosterEntry(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, quiz_id }: { studentId: string; quiz_id: string }) =>
      apiFetch<RosterEntry>(`/exam-sessions/${examSessionId}/roster/${studentId}`, {
        method: 'POST',
        body: { quiz_id },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'roster', examSessionId] });
    },
  });
}

/** DELETE /exam-sessions/{id}/roster/{studentId} — ADMIN only. `reason` required, non-empty (EC-016). */
export function useRemoveRosterEntry(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, quiz_id, reason }: { studentId: string; quiz_id: string; reason: string }) =>
      apiFetch<RosterEntry>(`/exam-sessions/${examSessionId}/roster/${studentId}`, {
        method: 'DELETE',
        body: { quiz_id, reason },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'roster', examSessionId] });
    },
  });
}
