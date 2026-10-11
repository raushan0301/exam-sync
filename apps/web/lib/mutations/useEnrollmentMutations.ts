'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { downloadBulkImportTemplate, uploadBulkImportFile } from './bulk-import-helpers';
import type { ImportJob, StudentSubjectEnrollment } from '../queries/types';

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

/** POST /enrollments/bulk-import — ADMIN only, multipart/form-data, field name `file`. */
export function useBulkImportEnrollments() {
  return useMutation({
    mutationFn: (file: File) => uploadBulkImportFile('enrollments', file),
  });
}

/** GET /enrollments/bulk-import/template — downloads the .xlsx template via the browser. */
export function downloadEnrollmentTemplate() {
  return downloadBulkImportTemplate('enrollments', 'enrollment-bulk-import-template.xlsx');
}

/**
 * POST /enrollments/bulk — ADMIN only, one request for the whole batch
 * (`students × subjects` rows) instead of one request each, which would
 * trip the API's 100 req/min rate limit. Processing is synchronous
 * server-side, so the import job is already final when the id comes back;
 * it's fetched once to read the per-row results.
 */
export function useBulkEnroll() {
  return useMutation({
    mutationFn: async (enrollments: CreateEnrollmentInput[]): Promise<ImportJob> => {
      const { job_id } = await apiFetch<{ job_id: string }>('/enrollments/bulk', {
        method: 'POST',
        body: { enrollments },
      });
      return apiFetch<ImportJob>(`/import-jobs/${job_id}`);
    },
  });
}
