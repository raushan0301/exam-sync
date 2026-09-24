'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { RoomAvailabilityCalendarEntry } from './types';

export interface UseRoomsAvailabilityParams {
  date: string;
  roomId?: string;
}

/**
 * `GET /rooms/availability?date=...` — added by the faculty-lifecycle-
 * ownership change for the room-availability calendar (faculty picking a
 * room/time BEFORE allocating; admin's read-only schedule view). Reachable
 * by both ADMIN and FACULTY. Disabled until `date` is present.
 */
export function useRoomsAvailability(params: UseRoomsAvailabilityParams | undefined) {
  const query: Record<string, string | undefined> = {
    date: params?.date,
    room_id: params?.roomId,
  };

  return useQuery({
    queryKey: queryKeys.roomsAvailabilityCalendar(query),
    queryFn: () => apiFetch<RoomAvailabilityCalendarEntry[]>('/rooms/availability', { query }),
    enabled: hasStoredSession() && !!params?.date,
    staleTime: 10_000,
  });
}
