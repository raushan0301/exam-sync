'use client';

import { Badge, StatusBadge } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useSessionAttendance } from '@/lib/queries/useSessionAttendance';
import type { AttendanceOverviewRow, ExamSessionDetail } from '@/lib/queries/types';

export interface AttendanceOverviewPanelProps {
  session: ExamSessionDetail;
}

/**
 * ADMIN/monitoring view of `GET /exam-sessions/{id}/attendance` — a plain
 * table, reusing M4's `DataTable`. The endpoint now denormalizes the
 * student name/roll number, quiz title, and seat label onto each row
 * (`AttendanceOverviewRow`), so this shows real names instead of the raw
 * `quiz_student_assignment_id`/`seat_id` the base `Attendance` row carries.
 */
export function AttendanceOverviewPanel({ session }: AttendanceOverviewPanelProps) {
  const { data, isLoading, isError, error, refetch, isFetching } = useSessionAttendance(session.id, { all: true });

  const columns: DataTableColumn<AttendanceOverviewRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (a) => `${a.quizStudentAssignment.student.rollNumber} — ${a.quizStudentAssignment.student.name}`,
    },
    { key: 'quiz', header: 'Quiz', render: (a) => a.quizStudentAssignment.quiz.title },
    { key: 'seat', header: 'Seat', render: (a) => a.seat.seatLabel },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    { key: 'method', header: 'Method', render: (a) => a.method },
    { key: 'markedAt', header: 'Marked At', render: (a) => new Date(a.markedAt).toLocaleString() },
    { key: 'locked', header: 'Locked', render: (a) => (a.locked ? <Badge color="neutral">Locked</Badge> : '—') },
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      getRowKey={(a) => a.id}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      retrying={isFetching}
      errorTitle="Couldn't load attendance"
      errorDescription={error ? undefined : undefined}
      emptyTitle="No attendance recorded yet"
      emptyDescription="Attendance marking will be available once the session starts and invigilators begin marking students in the room."
    />
  );
}
