'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { Invigilator, InvigilatorRole } from '../queries/types';

export interface AssignInvigilatorInput {
  room_id: string;
  faculty_id: string;
  role: InvigilatorRole;
}

/**
 * POST /exam-sessions/{id}/invigilators — FACULTY only, ownership-gated.
 * Verified against `InvigilationService.assign`. May 409 in three ways,
 * all indistinguishable to the caller except by message (no `details` on
 * any of them here, unlike room-allocation/seating's structured conflict
 * details):
 *  - the exact-duplicate backstop ("already assigned ... for this room and
 *    session")
 *  - BR-031 overlap — "already invigilating an overlapping session" — this
 *    one DOES carry `details: ConflictDetail[]` from the Conflict Engine
 *  - a CANCELLED session guard
 * The room must already be allocated to the session (404 otherwise).
 */
export function useAssignInvigilator(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignInvigilatorInput) =>
      apiFetch<Invigilator>(`/exam-sessions/${examSessionId}/invigilators`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      // Shorter prefix (no trailing params object) so this invalidates
      // every paginated variant of the list, not just the exact-{} one.
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'invigilators', examSessionId] });
    },
  });
}

/**
 * DELETE /exam-sessions/{id}/invigilators/{invigilatorId} — FACULTY only,
 * ownership-gated. The only way to correct a wrong/outdated assignment
 * (wrong faculty, room, or role) — there's no in-place edit, so
 * `InvigilatorPanel` removes then re-assigns.
 */
export function useRemoveInvigilator(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invigilatorId: string) =>
      apiFetch<void>(`/exam-sessions/${examSessionId}/invigilators/${invigilatorId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'invigilators', examSessionId] });
    },
  });
}
