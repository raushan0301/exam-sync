'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { SeatingGenerationSummary } from './types';

/**
 * GET /seating-jobs/{id} — ADMIN. This phase's generation is synchronous
 * (the `202` response already carries the final summary), so this hook is
 * built for contract completeness / a possible future "re-check a job"
 * affordance — the main generate flow never needs to poll it (verified
 * against `SeatingEngineService.getJob`, which just re-reads the same
 * `SeatingPlan` row by id and re-summarizes it).
 */
export function useSeatingJob(jobId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.seatingJob(jobId ?? ''),
    queryFn: () => apiFetch<SeatingGenerationSummary>(`/seating-jobs/${jobId}`),
    enabled: hasStoredSession() && !!jobId,
    staleTime: 10_000,
  });
}
