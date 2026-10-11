'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { RoomRequest } from '../queries/types';

/** A request or decision changes the requests, the session (status, rooms), and each room's seating plan. */
function useInvalidateRoomRequestData() {
  const queryClient = useQueryClient();
  return (examSessionId?: string) => {
    queryClient.invalidateQueries({ queryKey: ['room-requests'] });
    queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    queryClient.invalidateQueries({ queryKey: ['seating-plans'] });
    if (examSessionId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', examSessionId, 'rooms'] });
    }
  };
}

export interface CreateRoomRequestInput {
  room_ids: string[];
  reason: string;
  empty_columns?: boolean;
}

/** POST /exam-sessions/{id}/room-requests — FACULTY. Sends the session back to the Rooms step and locks the free rooms until an admin decides. */
export function useCreateRoomRequest(examSessionId: string) {
  const invalidate = useInvalidateRoomRequestData();
  return useMutation({
    mutationFn: (input: CreateRoomRequestInput) =>
      apiFetch<RoomRequest>(`/exam-sessions/${examSessionId}/room-requests`, { method: 'POST', body: input }),
    onSuccess: () => invalidate(examSessionId),
  });
}

/** POST /room-requests/{id}/cancel — FACULTY. Withdraws a pending request; the session returns to seating as it was. */
export function useCancelRoomRequest(examSessionId?: string) {
  const invalidate = useInvalidateRoomRequestData();
  return useMutation({
    mutationFn: (id: string) => apiFetch<RoomRequest>(`/room-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidate(examSessionId),
  });
}

/** POST /room-requests/{id}/approve — ADMIN. Adds the rooms (optionally changed) and re-splits the students of rooms that are not finalized. */
export function useApproveRoomRequest() {
  const invalidate = useInvalidateRoomRequestData();
  return useMutation({
    mutationFn: ({ id, room_ids, note }: { id: string; room_ids?: string[]; note?: string }) =>
      apiFetch<RoomRequest>(`/room-requests/${id}/approve`, { method: 'POST', body: { ...(room_ids ? { room_ids } : {}), ...(note ? { note } : {}) } }),
    onSuccess: (data) => invalidate(data.examSessionId),
  });
}

/** POST /room-requests/{id}/reject — ADMIN. The note is required; the session goes back to seating as it was. */
export function useRejectExtraRoomRequest() {
  const invalidate = useInvalidateRoomRequestData();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      apiFetch<RoomRequest>(`/room-requests/${id}/reject`, { method: 'POST', body: { note } }),
    onSuccess: (data) => invalidate(data.examSessionId),
  });
}
