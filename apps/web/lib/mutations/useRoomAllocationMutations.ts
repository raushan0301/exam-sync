'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { ExamSession } from '../queries/types';

export type AllocateRoomsInput = { room_ids: string[] } | { auto: true; candidate_room_ids?: string[] } | Record<string, never>;

export interface RequestRoomsInput {
  room_ids: string[];
  backup_room_id?: string;
  strategy?: string;
}

/**
 * POST /exam-sessions/{id}/rooms/request — FACULTY, ownership-gated.
 * Submits the room set the faculty picked (from a RoomSuggestionService
 * strategy or by hand) plus an optional backup room. Moves the session
 * ASSIGNING_STUDENTS -> ROOM_ALLOCATION for admin review; does not
 * allocate anything itself.
 */
export function useRequestRooms(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestRoomsInput) =>
      apiFetch<ExamSession>(`/exam-sessions/${examSessionId}/rooms/request`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      // Sibling list key, not covered by invalidating the detail key —
      // see useExamSessionMutations.ts's own comment on this.
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}

/**
 * POST /exam-sessions/{id}/rooms/allocate-preapproved — FACULTY,
 * ownership-gated. Self-service allocation using ONLY the room(s) an
 * admin already approved at quiz-approval time (`Quiz.requestedRoomIds`)
 * — skips the separate room-request → admin-review cycle entirely for
 * this common case. 409s if any attached quiz has no admin-approved
 * room request (use the manual request flow instead).
 */
export function useAllocatePreApprovedRooms(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ExamSession>(`/exam-sessions/${examSessionId}/rooms/allocate-preapproved`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      // Sibling list key, not covered by invalidating the detail key —
      // see useExamSessionMutations.ts's own comment on this.
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}

/**
 * POST /exam-sessions/{id}/rooms/allocate — ADMIN only, the approval
 * step. Omit the body to approve the faculty's request as-is; pass
 * `room_ids` to swap in a different set, or `auto: true` for an
 * algorithmic pick. On success the session moves to SEATING_GENERATION.
 * A capacity shortfall or room/time conflict 409s with
 * `{message, details: ConflictDetail[]}`.
 */
export function useAllocateRooms(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AllocateRoomsInput = {}) =>
      apiFetch<ExamSession>(`/exam-sessions/${examSessionId}/rooms/allocate`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      // Sibling list key, not covered by invalidating the detail key —
      // see useExamSessionMutations.ts's own comment on this.
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}

/** POST /exam-sessions/{id}/rooms/reject — ADMIN only. Sends the room request back to the faculty with a reason; the session returns to ASSIGNING_STUDENTS. */
export function useRejectRoomRequest(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiFetch<ExamSession>(`/exam-sessions/${examSessionId}/rooms/reject`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      // Sibling list key, not covered by invalidating the detail key —
      // see useExamSessionMutations.ts's own comment on this.
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}
