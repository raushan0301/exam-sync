'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { queryKeys } from '../queries/queryKeys';
import type { Attendance, AttendanceMethod, AttendanceStatus } from '../queries/types';

export interface MarkAttendanceInput {
  student_id: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
}

/**
 * POST /exam-sessions/{id}/attendance — FACULTY (invigilator-of-record)
 * only, verified against `AttendanceService.mark`. Hard preconditions, all
 * server-enforced (see this file's callers for how each is surfaced):
 *  - session must be IN_PROGRESS (422 BR-032, message carries actual status)
 *  - session must not be CANCELLED (409 BR-036)
 *  - student must have an ASSIGNED `quizStudentAssignment` here (404)
 *  - no existing attendance for that assignment yet (409 BR-033)
 *  - a FINALIZED seating assignment must exist for this student+quiz (409)
 *  - caller must be the invigilator-of-record for the seat's room (403)
 * `seat_id` is never sent — the server derives it from the student's own
 * finalized seating assignment.
 */
export function useMarkAttendance(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkAttendanceInput) =>
      apiFetch<Attendance>(`/exam-sessions/${examSessionId}/attendance`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'attendance', examSessionId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.examSession(examSessionId) });
    },
  });
}

export interface UpdateAttendanceInput {
  attendanceId: string;
  status: AttendanceStatus;
  /** Required once the record is `locked` (BR-035) — a 423 is thrown server-side if omitted on a real status change. */
  reason?: string;
}

/**
 * PATCH /attendance/{id} — ADMIN or FACULTY (invigilator-of-record).
 * Verified against `AttendanceService.update`:
 *  - `status === existing.status` is a silent no-op success, no reason
 *    needed (nothing actually changed)
 *  - otherwise, if the record is already `locked`, omitting `reason`
 *    throws a real `423 Locked` (not 400/409) — `error-mapping.ts` already
 *    maps 423 to `kind: 'locked'`, reusing the same convention M7's
 *    roster-remove-reason and M5's quiz-reject-reason established for
 *    "conditionally required field enforced via a non-400 status".
 * Callers should proactively show the reason field once they know
 * `attendance.locked === true`, rather than waiting for the 423 round trip.
 */
export function useUpdateAttendance(examSessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attendanceId, status, reason }: UpdateAttendanceInput) =>
      apiFetch<Attendance>(`/attendance/${attendanceId}`, {
        method: 'PATCH',
        body: { status, reason },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-sessions', 'attendance', examSessionId] });
      queryClient.invalidateQueries({ queryKey: ['students', 'attendance-history'] });
    },
  });
}
