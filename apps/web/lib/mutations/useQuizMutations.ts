'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { Quiz } from '../queries/types';

export interface CreateQuizInput {
  title: string;
  subject_id: string;
  batch_ids: string[];
  academic_year: string;
  semester: number;
  duration_minutes?: number;
  total_marks?: number;
  question_count?: number;
  instructions?: string;
  quiz_type?: string;
  preferred_date?: string;
  preferred_time?: string;
}

export type UpdateQuizInput = Partial<CreateQuizInput>;

/** POST /quizzes — FACULTY only. */
export function useCreateQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQuizInput) => apiFetch<Quiz>('/quizzes', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quizzes', 'list'] });
    },
  });
}

/**
 * PATCH /quizzes/{id} — requires the caller's last-known `version` sent
 * as the `If-Match` header (BR-051's optimistic lock); a mismatch 409s.
 */
export function useUpdateQuiz(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, version }: { input: UpdateQuizInput; version: number }) =>
      apiFetch<Quiz>(`/quizzes/${id}`, {
        method: 'PATCH',
        body: input,
        headers: { 'If-Match': String(version) },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quizzes', 'list'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.quiz(id) });
    },
  });
}

/** POST /quizzes/{id}/submit — FACULTY owner only. Surfaces the real 422 completeness message. */
export function useSubmitQuiz(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Quiz>(`/quizzes/${id}/submit`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quizzes', 'list'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.quiz(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.quizApprovalHistory(id) });
    },
  });
}

/** POST /quizzes/{id}/approve — ADMIN only, requires `If-Match: version` (EC-047). */
export function useApproveQuiz(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      apiFetch<Quiz>(`/quizzes/${id}/approve`, {
        method: 'POST',
        headers: { 'If-Match': String(version) },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quizzes', 'list'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.quiz(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.quizApprovalHistory(id) });
    },
  });
}

/** POST /quizzes/{id}/reject — ADMIN only. `reason` is enforced server-side as a 422 (BR-012). */
export function useRejectQuiz(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiFetch<Quiz>(`/quizzes/${id}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quizzes', 'list'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.quiz(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.quizApprovalHistory(id) });
    },
  });
}
