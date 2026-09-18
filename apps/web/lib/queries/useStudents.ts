'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import type { AcademicStatus, PaginatedResult, Student } from './types';

export interface UseStudentsParams {
  status?: AcademicStatus;
  search?: string;
  programId?: string;
  batchId?: string;
  cursor?: string;
  limit?: number;
}

/** GET /students — ADMIN-only. Supports search (students.controller.ts). */
export function useStudents(params: UseStudentsParams = {}) {
  const query: Record<string, string | undefined> = {
    status: params.status,
    search: params.search || undefined,
    program_id: params.programId,
    batch_id: params.batchId,
    cursor: params.cursor,
    limit: params.limit ? String(params.limit) : undefined,
  };

  return useQuery({
    queryKey: queryKeys.students(query),
    queryFn: () => apiFetch<PaginatedResult<Student>>('/students', { query }),
    enabled: hasStoredSession(),
    staleTime: 30_000,
  });
}
