'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { RoomSuggestionResponse, RoomAvailabilityPreview } from './types';

/** GET /quizzes/{id}/rooms/suggest — FACULTY, ownership-gated, DRAFT/REJECTED only. */
export function useQuizRoomSuggestions(quizId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.quizRoomSuggestions(quizId),
    queryFn: () => apiFetch<RoomSuggestionResponse>(`/quizzes/${quizId}/rooms/suggest`),
    enabled: hasStoredSession() && enabled && !!quizId,
  });
}

/** GET /quizzes/{id}/rooms/conflicts — ADMIN unscoped, FACULTY owner. Live availability of the quiz's requested + backup room. */
export function useQuizRoomConflicts(quizId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.quizRoomConflicts(quizId),
    queryFn: () => apiFetch<RoomAvailabilityPreview>(`/quizzes/${quizId}/rooms/conflicts`),
    enabled: hasStoredSession() && enabled && !!quizId,
  });
}
