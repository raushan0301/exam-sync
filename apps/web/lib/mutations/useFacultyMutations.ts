'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
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
