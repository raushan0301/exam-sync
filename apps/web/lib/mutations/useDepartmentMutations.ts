'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { downloadBulkImportTemplate, uploadBulkImportFile } from './bulk-import-helpers';
import type { AcademicStatus, Department } from '../queries/types';

export interface CreateDepartmentInput {
  name: string;
  code: string;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string;
  status?: AcademicStatus;
}

export function useCreateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDepartmentInput) =>
      apiFetch<Department>('/departments', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments', 'list'] });
    },
  });
}

export function useUpdateDepartment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDepartmentInput) =>
      apiFetch<Department>(`/departments/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments', 'list'] });
    },
  });
}

/** POST /departments/bulk-import — multipart/form-data, field name `file`. See useStudentMutations.ts's useBulkImportStudents() for the pattern this mirrors. */
export function useBulkImportDepartments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadBulkImportFile('departments', file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments', 'list'] });
    },
  });
}

/** GET /departments/bulk-import/template — downloads the .xlsx template via the browser. */
export function downloadDepartmentTemplate() {
  return downloadBulkImportTemplate('departments', 'department-bulk-import-template.xlsx');
}
