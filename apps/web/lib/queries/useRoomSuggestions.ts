'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { RoomSuggestionResponse } from './types';

/** GET /exam-sessions/{id}/rooms/suggest — FACULTY, ownership-gated. Three algorithm previews sized against real room capacity + live availability. */
export function useRoomSuggestions(examSessionId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.roomSuggestions(examSessionId),
    queryFn: () => apiFetch<RoomSuggestionResponse>(`/exam-sessions/${examSessionId}/rooms/suggest`),
    enabled: hasStoredSession() && enabled && !!examSessionId,
  });
}
