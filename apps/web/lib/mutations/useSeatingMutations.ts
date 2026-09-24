'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { SeatingGenerationSummary, SeatingPlan, SeatingStrategyName } from '../queries/types';

export interface GenerateSeatingInput {
  room_id: string;
  strategy: SeatingStrategyName;
}

/**
 * POST /exam-sessions/{id}/seating/generate — ADMIN only. Despite the
 * `202` status, `SeatingEngineService.generate` runs synchronously — the
 * response already carries the final `SeatingGenerationSummary` (status,
 * soft_constraint_score, hard/soft violations, and — for `ANTI_CHEATING`
 * only — the verbatim `disclaimer`), so this is modeled as a plain
 * one-shot mutation with no polling, same pattern as
 * `useAssignStudents`/`useAllocateRooms`.
 *
 * IDEMPOTENT (EC-032): regenerating for the same session+room while a
 * DRAFT/VALIDATED/FINALIZED plan already exists short-circuits to THAT
 * plan's summary server-side rather than erroring or creating a
 * duplicate — no special client-side handling needed beyond invalidating
 * the session detail + the returned plan's query key so the UI picks up
 * whichever plan is now current.
 */
export function useGenerateSeating(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateSeatingInput) =>
      apiFetch<SeatingGenerationSummary>(`/exam-sessions/${examSessionId}/seating/generate`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatingPlan(data.seating_plan_id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatingJob(data.job_id) });
    },
  });
}

/**
 * POST /exam-sessions/{id}/seating/regenerate — FACULTY only. Unlike
 * `generate`, this is NOT idempotent by design — it marks the room's
 * current DRAFT/VALIDATED/FAILED plan SUPERSEDED and always creates a
 * fresh one with the given strategy. Lets a faculty change strategy after
 * seeing the generated result but before finalizing; 409s if that room's
 * plan is already FINALIZED (finalization is a one-way door).
 */
export function useRegenerateSeating(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateSeatingInput) =>
      apiFetch<SeatingGenerationSummary>(`/exam-sessions/${examSessionId}/seating/regenerate`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatingPlan(data.seating_plan_id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatingJob(data.job_id) });
    },
  });
}

/**
 * POST /seating-plans/{id}/finalize — ADMIN only, no body. Re-validates
 * fresh (ADR-004) rather than trusting the plan's stale VALIDATED status,
 * so it can 409 in two DISTINCT ways that must be surfaced differently to
 * the admin (verified against `SeatingEngineService.finalize`):
 *
 *  - "wrong status" 409 — `plan.status !== VALIDATED` (e.g. already
 *    FINALIZED, or still DRAFT/FAILED). Message:
 *    `Seating plan is in status "${status}" and can only be finalized
 *    from VALIDATED.` This means "not ready yet" — nothing to fix but
 *    wait / regenerate is not implied.
 *  - "hard violations on re-validation" 409 —
 *    `{message: 'This seating plan has hard constraint violations and
 *    cannot be finalized (BR-026).', details: hardViolations}`. This
 *    means "something changed since generation" (e.g. a seat/roster edit)
 *    — the plan should be regenerated, not retried as-is.
 *
 * Both arrive as `ApiError` with `status === 409`; callers distinguish
 * them by matching `error.message` against BR-026's fixed wording (the
 * only field structurally different between the two) rather than relying
 * on `details` alone, since a "wrong status" 409 carries no `details`.
 */
export function useFinalizeSeatingPlan(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      apiFetch<SeatingPlan>(`/seating-plans/${planId}/finalize`, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatingPlan(data.id) });
    },
  });
}

/** BR-026's exact message substring — used to distinguish the two finalize 409 cases. */
export const FINALIZE_HARD_VIOLATIONS_MESSAGE =
  'This seating plan has hard constraint violations and cannot be finalized (BR-026).';

export function isFinalizeHardViolations409(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message?: unknown }).message === 'string' &&
    (err as { message: string }).message.includes(FINALIZE_HARD_VIOLATIONS_MESSAGE)
  );
}
