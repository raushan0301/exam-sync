'use client';

import { useQuery } from '@tanstack/react-query';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchList } from './fetch-list';
import type { AcademicStatus, Batch } from './types';

export interface UseBatchesParams {
  status?: AcademicStatus;
  programId?: string;
  year?: number;
  cursor?: string;
  limit?: number;
  /** Fetch EVERY page (follows `next_cursor`) instead of one page — for pick-lists that must show all rows. */
  all?: boolean;
}

/**
 * GET /batches — confirmed (batches.controller.ts) does NOT accept `search`
 * (no `search` query param on this controller, unlike departments/programs).
 * It accepts cursor/limit/status/program_id/year instead — do not add a
 * client-side search UI for batches.
 */
export function useBatches(params: UseBatchesParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    program_id: params.programId,
    year: params.year ? String(params.year) : undefined,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
    all: params.all ? 'true' : undefined,
  };

  return useQuery({
    queryKey: queryKeys.batches(query),
    queryFn: () => fetchList<Batch>('/batches', query),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
