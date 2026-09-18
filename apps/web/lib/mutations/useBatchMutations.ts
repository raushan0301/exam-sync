'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { AcademicStatus, Batch } from '../queries/types';

export interface CreateBatchInput {
  program_id: string;
  year: number;
  section: string;
}

export interface UpdateBatchInput {
  program_id?: string;
  year?: number;
  section?: string;
  status?: AcademicStatus;
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBatchInput) => apiFetch<Batch>('/batches', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches', 'list'] });
    },
  });
}

export function useUpdateBatch(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBatchInput) => apiFetch<Batch>(`/batches/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches', 'list'] });
    },
  });
}
