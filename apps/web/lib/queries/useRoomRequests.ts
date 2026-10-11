'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { ExtraRoomsState, RoomRequest, RoomRequestDetail, RoomRequestStatus } from './types';

export interface UseRoomRequestsParams {
  status?: RoomRequestStatus;
  examSessionId?: string;
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page — for counts. */
  all?: boolean;
  enabled?: boolean;
}

/** GET /room-requests — an ADMIN sees every "more rooms" request, a faculty member their own. Newest first. */
export function useRoomRequests(params: UseRoomRequestsParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    exam_session_id: params.examSessionId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };
  return useQuery({
    queryKey: queryKeys.roomRequests(query),
    queryFn: () => fetchList<RoomRequest>('/room-requests', query),
    enabled: hasStoredSession() && (params.enabled ?? true),
    staleTime: 5_000,
  });
}

/** GET /room-requests/{id} — with live availability and (for the review screen) the free rooms that could replace the asked-for ones. */
export function useRoomRequest(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.roomRequest(id ?? ''),
    queryFn: () => apiFetch<RoomRequestDetail>(`/room-requests/${id}`),
    enabled: hasStoredSession() && !!id,
    staleTime: 0,
  });
}

/** GET /exam-sessions/{id}/rooms/extra — FACULTY. Shortfall, nearest free rooms, and any pending request. `emptyColumns` re-sizes for that answer. */
export function useExtraRooms(examSessionId: string, enabled = true, emptyColumns?: boolean) {
  return useQuery({
    queryKey: queryKeys.extraRooms(examSessionId, emptyColumns),
    queryFn: () =>
      apiFetch<ExtraRoomsState>(`/exam-sessions/${examSessionId}/rooms/extra${emptyColumns === undefined ? '' : `?empty_columns=${emptyColumns}`}`),
    enabled: hasStoredSession() && enabled && !!examSessionId,
    staleTime: 0,
  });
}
