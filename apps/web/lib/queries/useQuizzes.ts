'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { PaginatedResult, Quiz, QuizApprovalHistoryEntry, QuizStatus } from './types';

export interface UseQuizzesParams {
  status?: QuizStatus;
  subjectId?: string;
  facultyId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * GET /quizzes — self-scoped server-side (FACULTY sees only their own/
 * co-instructed quizzes, ADMIN sees everything, optionally filtered by
 * `status`). No client-side scoping is applied here on top of that.
 */
export function useQuizzes(params: UseQuizzesParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    subject_id: params.subjectId,
    faculty_id: params.facultyId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.quizzes(query),
    queryFn: () => apiFetch<PaginatedResult<Quiz>>('/quizzes', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}

/**
 * GET /quizzes/{id} — ADMIN, or the owning/co-instructor FACULTY
 * (404-not-403, IDOR-safe per quizzes.service.ts's `findByIdScoped`).
 */
export function useQuiz(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.quiz(id ?? ''),
    queryFn: () => apiFetch<Quiz>(`/quizzes/${id}`),
    enabled: hasStoredSession() && !!id,
    staleTime: 10_000,
  });
}

/**
 * GET /quizzes/{id}/approval-history — ADMIN, or the **owning** FACULTY
 * specifically (narrower than the quiz detail's owner-or-co-instructor
 * rule — verified in quizzes.service.ts's `getApprovalHistory`).
 */
export function useQuizApprovalHistory(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.quizApprovalHistory(id ?? ''),
    queryFn: () => apiFetch<QuizApprovalHistoryEntry[]>(`/quizzes/${id}/approval-history`),
    enabled: hasStoredSession() && !!id,
    staleTime: 10_000,
  });
}
