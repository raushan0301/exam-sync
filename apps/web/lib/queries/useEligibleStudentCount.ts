'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';

export interface UseEligibleStudentCountParams {
  subjectId: string;
  batchIds: string[];
  academicYear: string;
  semester: number | '';
}

/**
 * `GET /quizzes/eligible-student-count` — FACULTY. Real enrolled-student
 * count for the (subject, batches, academic_year, semester) combination
 * picked so far on the quiz-creation form, so `student_count` can be
 * auto-filled from real data instead of a guess. Disabled until all four
 * inputs are present (matches the endpoint's own required-query-param
 * validation).
 */
export function useEligibleStudentCount(params: UseEligibleStudentCountParams) {
  const enabled =
    hasStoredSession() &&
    !!params.subjectId &&
    params.batchIds.length > 0 &&
    !!params.academicYear &&
    params.semester !== '' &&
    params.semester > 0;

  const query = {
    subject_id: params.subjectId || undefined,
    batch_ids: params.batchIds.length > 0 ? params.batchIds.join(',') : undefined,
    academic_year: params.academicYear || undefined,
    semester: params.semester !== '' ? String(params.semester) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.eligibleStudentCount(query),
    queryFn: () => apiFetch<{ count: number }>('/quizzes/eligible-student-count', { query }),
    enabled,
    staleTime: 10_000,
  });
}
