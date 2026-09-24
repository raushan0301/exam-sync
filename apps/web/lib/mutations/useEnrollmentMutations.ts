'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { StudentSubjectEnrollment } from '../queries/types';

export interface CreateEnrollmentInput {
  student_id: string;
  subject_id: string;
  batch_id: string;
  academic_year: string;
  semester: number;
}

/**
 * POST /enrollments — ADMIN or FACULTY (enrollments.controller.ts). No
 * bulk endpoint accessible to FACULTY (`POST /enrollments/bulk` is
 * ADMIN-only), so multi-student enrollment is done as one call per student
 * — same pattern as RosterPanel's multi-add. Already-enrolled
 * (student, subject, academic_year, semester) is a 409, surfaced per-call.
 */
export function useCreateEnrollment() {
  return useMutation({
    mutationFn: (input: CreateEnrollmentInput) =>
      apiFetch<StudentSubjectEnrollment>('/enrollments', { method: 'POST', body: input }),
  });
}
