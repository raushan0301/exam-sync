'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { downloadBulkImportTemplate, uploadBulkImportFile } from './bulk-import-helpers';
import type { AcademicStatus, Faculty } from '../queries/types';

export interface CreateFacultyInput {
  name: string;
  email: string;
  department_id: string;
  employee_code: string;
}

export interface UpdateFacultyInput {
  name?: string;
  department_id?: string;
  employee_code?: string;
  status?: AcademicStatus;
}

export function useCreateFaculty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFacultyInput) => apiFetch<Faculty>('/faculty', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faculty', 'list'] });
    },
  });
}

export function useUpdateFaculty(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateFacultyInput) =>
      apiFetch<Faculty>(`/faculty/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faculty', 'list'] });
    },
  });
}

/** POST /faculty/bulk-import — multipart/form-data, field name `file`. */
export function useBulkImportFaculty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadBulkImportFile('faculty', file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faculty', 'list'] });
    },
  });
}

/** GET /faculty/bulk-import/template — downloads the .xlsx template via the browser. */
export function downloadFacultyTemplate() {
  return downloadBulkImportTemplate('faculty', 'faculty-bulk-import-template.xlsx');
}
