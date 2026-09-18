'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
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
