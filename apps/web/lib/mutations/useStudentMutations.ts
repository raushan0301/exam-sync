'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE_URL, ApiError, NetworkError } from '../api-client';
import { getAccessToken } from '../token-storage';
import { downloadBulkImportTemplate } from './bulk-import-helpers';
import type { AcademicStatus, ImportJob, Student } from '../queries/types';

export interface CreateStudentInput {
  name: string;
  email: string;
  program_id: string;
  batch_id: string;
  roll_number: string;
}

export interface UpdateStudentInput {
  name?: string;
  program_id?: string;
  batch_id?: string;
  roll_number?: string;
  status?: AcademicStatus;
}

export function useCreateStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStudentInput) => apiFetch<Student>('/students', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', 'list'] });
    },
  });
}

export function useUpdateStudent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStudentInput) =>
      apiFetch<Student>(`/students/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', 'list'] });
    },
  });
}

/**
 * POST /students/bulk-import — multipart/form-data with field name `file`.
 * Bypasses apiFetch (which always sends `Content-Type: application/json`
 * and JSON.stringifies the body) since a multipart body must set its own
 * boundary-bearing Content-Type, which the browser only does correctly when
 * the header is left unset entirely for a `fetch` call with a FormData body.
 * Response is 202 `{job_id}` — synchronous processing under the hood
 * (students.service.ts), but the client-facing contract is already the
 * async job shape a later milestone's real queue will preserve.
 */
export function useBulkImportStudents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<{ job_id: string }> => {
      const formData = new FormData();
      formData.append('file', file);
      const token = getAccessToken();

      let res: Response;
      try {
        res = await fetch(new URL('/students/bulk-import', API_BASE_URL).toString(), {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: formData,
        });
      } catch (err) {
        throw new NetworkError(err);
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError(res.status, data);
      }
      return data as { job_id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students', 'list'] });
    },
  });
}

/** GET /import-jobs/{id} — one-shot fetch (not a hook) used to show the result of a bulk-import job on demand. */
export function fetchImportJob(id: string): Promise<ImportJob> {
  return apiFetch<ImportJob>(`/import-jobs/${id}`);
}

/** GET /students/bulk-import/template — downloads the .xlsx template via the browser. */
export function downloadStudentTemplate() {
  return downloadBulkImportTemplate('students', 'student-bulk-import-template.xlsx');
}
