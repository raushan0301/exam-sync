'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { downloadBulkImportTemplate, uploadBulkImportFile } from './bulk-import-helpers';
import { queryKeys } from '../queries/queryKeys';
import type { FacultyAssignment, FacultyAssignmentRole, ImportJob } from '../queries/types';

export interface CreateFacultyAssignmentInput {
  faculty_id: string;
  subject_id: string;
  batch_id: string;
  academic_year: string;
  semester: number;
  role: FacultyAssignmentRole;
}

/** POST /faculty-assignments — ADMIN only (BR-009 unique on faculty+subject+batch+year+semester). */
export function useCreateFacultyAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFacultyAssignmentInput) =>
      apiFetch<FacultyAssignment>('/faculty-assignments', { method: 'POST', body: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.facultyAssignments(variables.faculty_id) });
    },
  });
}

/**
 * DELETE /faculty-assignments/{id} — ADMIN only, no body. Soft-ends the
 * assignment (sets `endedAt`) — never hard-deletes (API_CONTRACT.md).
 */
export function useEndFacultyAssignment(facultyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<FacultyAssignment>(`/faculty-assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.facultyAssignments(facultyId) });
    },
  });
}

/**
 * POST /faculty-assignments/bulk — ADMIN only, one request for many rows
 * (e.g. one faculty + subject across many batches). Processing is
 * synchronous server-side, so the import job is already final when the id
 * comes back; it's fetched once to read the per-row results (a failed row
 * never blocks the rest — each carries its own message).
 */
export function useBulkAssignFaculty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignments: CreateFacultyAssignmentInput[]): Promise<ImportJob> => {
      const { job_id } = await apiFetch<{ job_id: string }>('/faculty-assignments/bulk', {
        method: 'POST',
        body: { assignments },
      });
      return apiFetch<ImportJob>(`/import-jobs/${job_id}`);
    },
    onSuccess: (_job, variables) => {
      for (const id of new Set(variables.map((v) => v.faculty_id))) {
        queryClient.invalidateQueries({ queryKey: queryKeys.facultyAssignments(id) });
      }
    },
  });
}

/** POST /faculty-assignments/bulk-import — ADMIN only, multipart/form-data, field name `file`. */
export function useBulkImportFacultyAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadBulkImportFile('faculty-assignments', file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faculty-assignments', 'list'] });
    },
  });
}

/** GET /faculty-assignments/bulk-import/template — downloads the .xlsx template via the browser. */
export function downloadFacultyAssignmentTemplate() {
  return downloadBulkImportTemplate('faculty-assignments', 'faculty-assignment-bulk-import-template.xlsx');
}

export type { FacultyAssignment };
