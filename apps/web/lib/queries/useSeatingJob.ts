'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { SeatingGenerationSummary } from './types';

/**
 * GET /seating-jobs/{id} — ADMIN (unscoped) or the owning/co-instructing
 * FACULTY (scoped, 404 otherwise). This phase's generation is synchronous
 * (the `202` response already carries the final summary), but
 * SeatingPanel.tsx DOES call this hook right after generating — the
 * `202` body and this endpoint return the identical shape
 * (`SeatingEngineService.getJob` just re-reads the same `SeatingPlan` row
 * by id and re-summarizes it), so re-fetching here is a deliberate refresh
 * rather than a genuine polling need.
 */
export function useSeatingJob(jobId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.seatingJob(jobId ?? ''),
    queryFn: () => apiFetch<SeatingGenerationSummary>(`/seating-jobs/${jobId}`),
    enabled: hasStoredSession() && !!jobId,
    staleTime: 10_000,
  });
}
