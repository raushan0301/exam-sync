'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { ExamSession } from '../queries/types';

export type AllocateRoomsInput = { room_ids: string[] } | { auto: true; candidate_room_ids?: string[] };

/**
 * POST /exam-sessions/{id}/rooms/allocate — ADMIN only. Manual (`room_ids`)
 * or auto (`auto: true`, optional `candidate_room_ids` to narrow the
 * search). On success the session moves straight to SEATING_GENERATION
 * (room-allocation.service.ts collapses the two documented transitions
 * into one atomic step) — invalidate the session detail so the newly
 * allocated rooms and new status show up. A capacity shortfall or
 * room/time conflict 409s with `{message, details: ConflictDetail[]}`,
 * the same shape `error-mapping.ts` already surfaces for exam-session
 * conflicts.
 */
export function useAllocateRooms(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AllocateRoomsInput) =>
      apiFetch<ExamSession>(`/exam-sessions/${examSessionId}/rooms/allocate`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
    },
  });
}
