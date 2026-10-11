'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { ConflictCheckResult, ExamSession, ExamSessionDetail } from '../queries/types';

export interface CreateExamSessionInput {
  name: string;
  session_date: string;
  start_time: string;
  end_time: string;
}

export interface RescheduleExamSessionInput {
  session_date: string;
  start_time: string;
  end_time: string;
}

export interface UpdateSessionQuizzesInput {
  add: string[];
  remove: string[];
}

/**
 * POST /exam-sessions — ADMIN only. No `If-Match` — nothing exists yet to
 * version-conflict against on creation.
 */
export function useCreateExamSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExamSessionInput) =>
      apiFetch<ExamSession>('/exam-sessions', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}

/**
 * PATCH /exam-sessions/{id}/quizzes — ADMIN only, only while DRAFT
 * (exam-sessions.service.ts's `attachAndDetachQuizzes`). Verified: this
 * endpoint does NOT read an `If-Match` header — the server increments
 * `version` itself, so none is sent here (unlike Quiz's PATCH/approve).
 * May 409 with `{message, details: ConflictDetail[]}` for hard conflicts.
 */
export function useUpdateSessionQuizzes(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSessionQuizzesInput) =>
      apiFetch<ExamSessionDetail>(`/exam-sessions/${id}/quizzes`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.examSessionConflicts(id) });
      // The list view (admin "Exam Sessions" / faculty "My Exam Sessions")
      // is a SIBLING query key (['exam-sessions','list',...]), not a
      // parent of `examSession(id)` (['exam-sessions','detail',id]) — so
      // invalidating the detail key alone never touches it. Without this,
      // the list keeps showing the pre-attach quiz count/status for up to
      // its 30s staleTime after navigating back to it.
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}

/**
 * POST /exam-sessions/{id}/reschedule — ADMIN only, only while DRAFT. No
 * `If-Match` (verified against exam-sessions.service.ts's `reschedule`).
 * May 409 with `{message, details: ConflictDetail[]}` (EC-021) when the
 * Conflict Engine's re-check against the new window finds hard conflicts.
 */
export function useRescheduleExamSession(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RescheduleExamSessionInput) =>
      apiFetch<ExamSession>(`/exam-sessions/${id}/reschedule`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.examSessionConflicts(id) });
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'list'] });
    },
  });
}

/**
 * GET /exam-sessions/{id}/conflicts — ADMIN-only dry run, no commit.
 * Modeled as a manual-trigger `useMutation` (not a `useQuery` with
 * `enabled: false`) — there is no existing "check now" action pattern
 * elsewhere in this codebase to follow, and a GET-triggered mutation
 * keeps the on-demand call, its `isPending`/`error`/`data` UI state, and
 * the result attached directly to the button that triggered it, without
 * needing an `enabled` flag + manual `refetch()` dance for something that
 * is never meant to run on mount or revalidate in the background.
 */
export function useCheckExamSessionConflicts(id: string) {
  return useMutation({
    mutationFn: () => apiFetch<ConflictCheckResult>(`/exam-sessions/${id}/conflicts`),
  });
}

export type { ExamSessionDetail };
