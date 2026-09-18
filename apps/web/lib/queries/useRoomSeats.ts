'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { RoomSeat } from './types';

/** GET /rooms/{id}/seats — any authenticated role. Full seat list, not paginated. */
export function useRoomSeats(roomId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.roomSeats(roomId ?? ''),
    queryFn: () => apiFetch<RoomSeat[]>(`/rooms/${roomId}/seats`),
    enabled: hasStoredSession() && !!roomId,
    staleTime: 30_000,
  });
}
