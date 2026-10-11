'use client';

import { useQuery, useQueries } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { hasStoredSession } from '../token-storage';
import { queryKeys } from './queryKeys';
import { fetchAllPages } from './fetch-list';
import type { AcademicStatus, PaginatedResult, Student } from './types';

export interface UseStudentsParams {
  status?: AcademicStatus;
  search?: string;
  programId?: string;
  batchId?: string;
  cursor?: string;
  limit?: number;
}

/** GET /students — ADMIN or FACULTY (used by RosterPanel's "Add Student" picker). Supports search (students.controller.ts). */
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

/**
 * Fetches ACTIVE students across MULTIPLE sections/batches at once — one
 * `GET /students?batch_id=...` per batch (the endpoint only takes a single
 * `batch_id`), run in parallel via `useQueries`, then merged/deduped. Used
 * by RosterPanel's multi-section "Add Students" picker.
 */
export function useStudentsForBatches(batchIds: string[]) {
  const results = useQueries({
    queries: batchIds.map((batchId) => ({
      queryKey: queryKeys.students({ status: 'ACTIVE', batch_id: batchId, limit: '200' }),
      queryFn: () => fetchAllPages<Student>('/students', { status: 'ACTIVE', batch_id: batchId }),
      enabled: hasStoredSession(),
      staleTime: 30_000,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const isError = results.some((r) => r.isError);
  const byId = new Map<string, Student>();
  for (const r of results) {
    for (const s of r.data?.items ?? []) byId.set(s.id, s);
  }

  return { items: Array.from(byId.values()), isLoading, isError };
}
