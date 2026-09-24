'use client';

import { ClipboardList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Card, EmptyState, SkeletonText, Button, StatusBadge } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useMyFaculty } from '@/lib/queries/useFaculty';
import { useInvigilationDuties } from '@/lib/queries/useInvigilationDuties';
import { formatTime } from '@/lib/format-time';
import type { InvigilatorDuty, InvigilatorRole } from '@/lib/queries/types';

const ROLE_LABELS: Record<InvigilatorRole, string> = {
  LEAD_INVIGILATOR: 'Lead Invigilator',
  ASSISTANT_INVIGILATOR: 'Assistant Invigilator',
};

/**
 * FACULTY "My Invigilation Duties" — `GET /faculty/{id}/invigilation-duties`
 * is self-scoped server-side, but needed the caller's own Faculty-row id
 * as a path param, which `GET /users/me` never exposed. Resolved via
 * `GET /faculty/me`. Each row carries its session name/schedule and room
 * label directly (an invigilator can't call `GET /exam-sessions/{id}` on
 * someone else's session to look those up themselves).
 *
 * "Mark Attendance" links to `/faculty/exam-sessions/{id}/attendance` —
 * the intended discovery path that page's own header comment already
 * described, unblocked now that `ExamSessionsAccessRepository` grants a
 * session's assigned invigilators view access (not just its creator).
 */
export default function FacultyInvigilationDutiesPage() {
  const router = useRouter();
  const myFacultyQuery = useMyFaculty();
  const pager = useCursorPager();
  const dutiesQuery = useInvigilationDuties(myFacultyQuery.data?.id, { cursor: pager.cursor, limit: 25 });

  const columns: DataTableColumn<InvigilatorDuty>[] = [
    { key: 'session', header: 'Exam Session', render: (d) => d.examSession.name },
    {
      key: 'date',
      header: 'Date',
      render: (d) => d.examSession.sessionDate.slice(0, 10),
    },
    {
      key: 'time',
      header: 'Time',
      render: (d) => `${formatTime(d.examSession.startTime)} – ${formatTime(d.examSession.endTime)}`,
    },
    { key: 'room', header: 'Room', render: (d) => `${d.room.building} · ${d.room.roomNumber}` },
    { key: 'role', header: 'Role', render: (d) => ROLE_LABELS[d.role] },
    { key: 'assignedAt', header: 'Assigned', render: (d) => `${d.assignedAt.slice(0, 10)} ${formatTime(d.assignedAt)}` },
  ];

  const items = dutiesQuery.data?.items ?? [];
  // Once a session is COMPLETED (attendance locked, BR-035) or CANCELLED
  // (never happened at all), there's nothing left to do for it — keeping
  // either in the main list forever would bury the duties that still
  // need action under old/dead ones. Both move into a single read-only
  // History section instead, distinguished by their own status badge;
  // "Mark Attendance" makes no sense for a session that's either already
  // locked or was cancelled outright.
  const isHistorical = (d: InvigilatorDuty) => d.examSession.status === 'COMPLETED' || d.examSession.status === 'CANCELLED';
  const activeDuties = items.filter((d) => !isHistorical(d));
  const historyDuties = items.filter(isHistorical);

  const historyColumns: DataTableColumn<InvigilatorDuty>[] = [
    ...columns,
    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.examSession.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">My Invigilation Duties</h1>

      {myFacultyQuery.isLoading ? (
        <Card><SkeletonText lines={4} /></Card>
      ) : myFacultyQuery.isError ? (
        <Card>
          <EmptyState
            icon={<ClipboardList size={28} />}
            title="Not available"
            description="Couldn't resolve your faculty record — an administrator can tell you which sessions and rooms you're assigned to invigilate in the meantime."
          />
        </Card>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={activeDuties}
            getRowKey={(d) => d.id}
            isLoading={dutiesQuery.isLoading}
            isError={dutiesQuery.isError}
            onRetry={() => dutiesQuery.refetch()}
            errorTitle="Couldn't load your invigilation duties"
            emptyTitle="No invigilation duties yet"
            emptyDescription="Rooms you've been assigned to invigilate will appear here."
            renderActions={(d) => (
              <Button size="sm" onClick={() => router.push(`/faculty/exam-sessions/${d.examSessionId}/attendance`)}>
                Mark Attendance
              </Button>
            )}
          />

          {historyDuties.length > 0 && (
            <Card header={<h2 className="text-sm font-semibold text-text">History</h2>} padding="dense">
              <DataTable
                columns={historyColumns}
                data={historyDuties}
                getRowKey={(d) => d.id}
                isLoading={false}
                isError={false}
                emptyTitle="No past duties yet"
                renderActions={(d) =>
                  d.examSession.status === 'COMPLETED' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => router.push(`/faculty/exam-sessions/${d.examSessionId}/attendance`)}
                    >
                      View Attendance
                    </Button>
                  ) : null
                }
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
