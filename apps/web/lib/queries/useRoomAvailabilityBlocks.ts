'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { AvailabilityBlock } from './types';

export interface UseRoomAvailabilityBlocksParams {
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for views that must show/count all rows. */
  all?: boolean;
}

/** GET /rooms/{id}/availability-blocks — any authenticated role. Paginated. */
export function useRoomAvailabilityBlocks(roomId: string | undefined, params: UseRoomAvailabilityBlocksParams = {}) {
  const query: Record<string, string | undefined> = {
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.roomAvailabilityBlocks(roomId ?? '', query),
    queryFn: () => fetchList<AvailabilityBlock>(`/rooms/${roomId}/availability-blocks`, query),
    enabled: hasStoredSession() && !!roomId,
    staleTime: 30_000,
  });
}
