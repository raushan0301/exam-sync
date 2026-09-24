'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { downloadBulkImportTemplate, uploadBulkImportFile } from './bulk-import-helpers';
import type { AcademicStatus, Batch } from '../queries/types';

export interface CreateBatchInput {
  program_id: string;
  year: string;
  section: string;
  subsection: string;
}

export interface UpdateBatchInput {
  program_id?: string;
  year?: string;
  section?: string;
  subsection?: string;
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

/** POST /batches/bulk-import — multipart/form-data, field name `file`. */
export function useBulkImportBatches() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadBulkImportFile('batches', file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches', 'list'] });
    },
  });
}

/** GET /batches/bulk-import/template — downloads the .xlsx template via the browser. */
export function downloadBatchTemplate() {
  return downloadBulkImportTemplate('batches', 'batch-bulk-import-template.xlsx');
}
