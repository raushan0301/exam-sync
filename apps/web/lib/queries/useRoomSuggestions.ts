'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { RoomSuggestionResponse } from './types';

/** GET /exam-sessions/{id}/rooms/suggest — FACULTY, ownership-gated. Room plans sized against real room capacity + live availability; `emptyColumns` sizes rooms by usable seats only. */
export function useRoomSuggestions(examSessionId: string, enabled = true, emptyColumns = false) {
  return useQuery({
    queryKey: queryKeys.roomSuggestions(examSessionId, emptyColumns),
    queryFn: () => apiFetch<RoomSuggestionResponse>(`/exam-sessions/${examSessionId}/rooms/suggest${emptyColumns ? '?empty_columns=true' : ''}`),
    enabled: hasStoredSession() && enabled && !!examSessionId,
  });
}
