'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { Room } from './types';

export interface UseAvailableRoomsParams {
  date: string;
  startTime: string;
  endTime: string;
  minCapacity?: number;
}

/**
 * GET /rooms/available — any authenticated role. `date`/`startTime`/
 * `endTime` are required by the backend; disabled until all three are
 * present so this never fires a request the server would 400 on.
 */
export function useAvailableRooms(params: UseAvailableRoomsParams | undefined) {
  const query: Record<string, string | undefined> = {
    date: params?.date,
    start_time: params?.startTime,
    end_time: params?.endTime,
    min_capacity: params?.minCapacity ? String(params.minCapacity) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.availableRooms(query),
    queryFn: () => apiFetch<Room[]>('/rooms/available', { query }),
    enabled: hasStoredSession() && !!params?.date && !!params?.startTime && !!params?.endTime,
    staleTime: 10_000,
  });
}
