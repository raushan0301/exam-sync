'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { AvailabilityBlock, Room, RoomSeat, RoomStatus } from '../queries/types';

export interface CreateRoomInput {
  building: string;
  floor: number;
  room_number: string;
  capacity: number;
  rows: number;
  columns: number;
  accessibility_info?: Record<string, unknown>;
}

export interface UpdateRoomInput {
  building?: string;
  floor?: number;
  room_number?: string;
  capacity?: number;
  status?: RoomStatus;
  accessibility_info?: Record<string, unknown>;
}

/** POST /rooms — ADMIN only. Creating a room generates its full seat map from rows×columns server-side. */
export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomInput) => apiFetch<Room>('/rooms', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', 'list'] });
    },
  });
}

/**
 * PATCH /rooms/{id} — ADMIN only. Does NOT accept rows/columns (seat map
 * isn't resizable via PATCH — verified against update-room.dto.ts).
 */
export function useUpdateRoom(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoomInput) => apiFetch<Room>(`/rooms/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', 'list'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.room(id) });
    },
  });
}

/** PATCH /rooms/{id}/seats/{seatId} — ADMIN only. Disable/enable a seat or mark it accessible. */
export function useUpdateRoomSeat(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ seatId, is_active, is_accessible }: { seatId: string; is_active?: boolean; is_accessible?: boolean }) =>
      apiFetch<RoomSeat>(`/rooms/${roomId}/seats/${seatId}`, {
        method: 'PATCH',
        body: { is_active, is_accessible },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roomSeats(roomId) });
    },
  });
}

export interface CreateAvailabilityBlockInput {
  date: string;
  start_time: string;
  end_time: string;
  reason: string;
}

/** POST /rooms/{id}/availability-blocks — ADMIN only. `reason` required, non-empty. */
export function useCreateAvailabilityBlock(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAvailabilityBlockInput) =>
      apiFetch<AvailabilityBlock>(`/rooms/${roomId}/availability-blocks`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', 'availability-blocks', roomId] });
    },
  });
}
