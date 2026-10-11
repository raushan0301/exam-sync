'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';

/**
 * GET /exam-sessions/{id}/seating/current?room_id= — the room's latest non-superseded plan id (or null).
 * Lets the page find a plan that was generated earlier, so a reload doesn't show "not generated yet" for
 * a room that already has seating.
 */
export function useCurrentSeatingPlan(sessionId: string, roomId: string) {
  return useQuery({
    queryKey: queryKeys.currentSeatingPlan(sessionId, roomId),
    queryFn: () => apiFetch<{ seating_plan_id: string | null }>(`/exam-sessions/${sessionId}/seating/current?room_id=${roomId}`),
    enabled: hasStoredSession() && !!sessionId && !!roomId,
    staleTime: 0,
  });
}
