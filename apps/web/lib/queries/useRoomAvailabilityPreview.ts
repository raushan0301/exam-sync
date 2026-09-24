'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { RoomAvailabilityPreview } from './types';

/** GET /exam-sessions/{id}/rooms/preview — ADMIN unscoped, FACULTY owner. Live availability of the requested + backup room, with alternatives. */
export function useRoomAvailabilityPreview(examSessionId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.roomAvailabilityPreview(examSessionId),
    queryFn: () => apiFetch<RoomAvailabilityPreview>(`/exam-sessions/${examSessionId}/rooms/preview`),
    enabled: hasStoredSession() && enabled && !!examSessionId,
  });
}
