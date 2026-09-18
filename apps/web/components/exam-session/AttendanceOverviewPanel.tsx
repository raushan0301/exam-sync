'use client';

import { Badge, StatusBadge } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useSessionAttendance } from '@/lib/queries/useSessionAttendance';
import type { Attendance, ExamSessionDetail } from '@/lib/queries/types';

export interface AttendanceOverviewPanelProps {
  session: ExamSessionDetail;
}

/**
 * ADMIN/monitoring view of `GET /exam-sessions/{id}/attendance` — a plain
 * table, reusing M4's `DataTable`. The raw `Attendance` row (verified
 * against `AttendanceService.listForSession`) carries no joined
 * student/seat/faculty name — just ids — so this table shows exactly what
 * the endpoint returns rather than inventing a join the backend doesn't
 * provide.
 */
export function AttendanceOverviewPanel({ session }: AttendanceOverviewPanelProps) {
  const { data, isLoading, isError, error, refetch, isFetching } = useSessionAttendance(session.id, { limit: 100 });

  const columns: DataTableColumn<Attendance>[] = [
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    { key: 'method', header: 'Method', render: (a) => a.method },
    { key: 'markedAt', header: 'Marked At', render: (a) => new Date(a.markedAt).toLocaleString() },
    { key: 'locked', header: 'Locked', render: (a) => (a.locked ? <Badge color="neutral">Locked</Badge> : '—') },
    { key: 'assignment', header: 'Assignment ID', render: (a) => a.quizStudentAssignmentId },
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
