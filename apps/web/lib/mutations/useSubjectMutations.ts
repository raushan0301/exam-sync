'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { downloadBulkImportTemplate, uploadBulkImportFile } from './bulk-import-helpers';
import type { Subject } from '../queries/types';

export interface CreateSubjectInput {
  department_id: string;
  program_id?: string;
  code: string;
  name: string;
  credits?: number;
}

export interface UpdateSubjectInput {
  department_id?: string;
  program_id?: string;
  code?: string;
  name?: string;
  credits?: number;
  is_active?: boolean;
}

export function useCreateSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSubjectInput) => apiFetch<Subject>('/subjects', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects', 'list'] });
    },
  });
}

export function useUpdateSubject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSubjectInput) =>
      apiFetch<Subject>(`/subjects/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects', 'list'] });
    },
  });
}

/** POST /subjects/bulk-import — multipart/form-data, field name `file`. */
export function useBulkImportSubjects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadBulkImportFile('subjects', file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects', 'list'] });
    },
  });
}

/** GET /subjects/bulk-import/template — downloads the .xlsx template via the browser. */
export function downloadSubjectTemplate() {
  return downloadBulkImportTemplate('subjects', 'subject-bulk-import-template.xlsx');
}
