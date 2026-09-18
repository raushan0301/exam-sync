'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { AcademicStatus, Program } from '../queries/types';

export interface CreateProgramInput {
  department_id: string;
  name: string;
  code: string;
}

export interface UpdateProgramInput {
  department_id?: string;
  name?: string;
  code?: string;
  status?: AcademicStatus;
}

export function useCreateProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProgramInput) => apiFetch<Program>('/programs', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs', 'list'] });
    },
  });
}

export function useUpdateProgram(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProgramInput) =>
      apiFetch<Program>(`/programs/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs', 'list'] });
    },
  });
}
