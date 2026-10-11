'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { SuspensionRequest, SuspensionRequestStatus } from './types';

export interface UseSuspensionRequestsParams {
  status?: SuspensionRequestStatus;
  examSessionId?: string;
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) — for counts and "everything" views. */
  all?: boolean;
  enabled?: boolean;
}

/**
 * GET /suspension-requests — ADMIN sees every request, FACULTY only the ones
 * they filed (scoped server-side). Newest first.
 */
export function useSuspensionRequests(params: UseSuspensionRequestsParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    exam_session_id: params.examSessionId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.suspensionRequests(query),
    queryFn: () => fetchList<SuspensionRequest>('/suspension-requests', query),
    enabled: hasStoredSession() && (params.enabled ?? true),
    staleTime: 10_000,
  });
}
