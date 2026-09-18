'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { SeatingPlan } from './types';

/**
 * GET /seating-plans/{id} — ADMIN, or a FACULTY scoped to the owning exam
 * session (verified against `SeatingEngineService.findByIdScoped`).
 * Returns the plan row plus its `assignments`, each including the `seat`/
 * `student`/`quiz` joins the seat map needs.
 */
export function useSeatingPlan(planId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.seatingPlan(planId ?? ''),
    queryFn: () => apiFetch<SeatingPlan>(`/seating-plans/${planId}`),
    enabled: hasStoredSession() && !!planId,
    staleTime: 10_000,
  });
}
