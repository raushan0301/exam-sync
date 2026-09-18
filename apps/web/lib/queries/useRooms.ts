'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { PaginatedResult, Room, RoomStatus } from './types';

export interface UseRoomsParams {
  search?: string;
  status?: RoomStatus;
  building?: string;
  minCapacity?: number;
  cursor?: string;
  limit?: number;
}

/** GET /rooms — any authenticated role (read is open, per rooms.controller.ts's own comment). */
export function useRooms(params: UseRoomsParams = {}) {
  const query: Record<string, string | undefined> = {
    search: params.search || undefined,
    status: params.status,
    building: params.building || undefined,
    min_capacity: params.minCapacity ? String(params.minCapacity) : undefined,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.rooms(query),
    queryFn: () => apiFetch<PaginatedResult<Room>>('/rooms', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}

/** GET /rooms/{id} — any authenticated role. */
export function useRoom(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.room(id ?? ''),
    queryFn: () => apiFetch<Room>(`/rooms/${id}`),
    enabled: hasStoredSession() && !!id,
    staleTime: 30_000,
  });
}
