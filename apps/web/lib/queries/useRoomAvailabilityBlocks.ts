'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AvailabilityBlock, PaginatedResult } from './types';

export interface UseRoomAvailabilityBlocksParams {
  cursor?: string;
  limit?: number;
}

/** GET /rooms/{id}/availability-blocks — any authenticated role. Paginated. */
export function useRoomAvailabilityBlocks(roomId: string | undefined, params: UseRoomAvailabilityBlocksParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.roomAvailabilityBlocks(roomId ?? '', query),
    queryFn: () => apiFetch<PaginatedResult<AvailabilityBlock>>(`/rooms/${roomId}/availability-blocks`, { query }),
    enabled: hasStoredSession() && !!roomId,
    staleTime: 30_000,
  });
}
