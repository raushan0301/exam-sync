'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
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
