'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { FacultyAssignment, FacultyAssignmentRole } from '../queries/types';

export interface CreateFacultyAssignmentInput {
  faculty_id: string;
  subject_id: string;
  batch_id: string;
  academic_year: string;
  semester: number;
  role: FacultyAssignmentRole;
}

/** POST /faculty-assignments — ADMIN only (BR-009 unique on faculty+subject+batch+year+semester). */
export function useCreateFacultyAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFacultyAssignmentInput) =>
      apiFetch<FacultyAssignment>('/faculty-assignments', { method: 'POST', body: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.facultyAssignments(variables.faculty_id) });
    },
  });
}

/**
 * DELETE /faculty-assignments/{id} — ADMIN only, no body. Soft-ends the
 * assignment (sets `endedAt`) — never hard-deletes (API_CONTRACT.md).
 */
export function useEndFacultyAssignment(facultyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<FacultyAssignment>(`/faculty-assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.facultyAssignments(facultyId) });
    },
  });
}

export type { FacultyAssignment };
