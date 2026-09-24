'use client';

import { useRouter } from 'next/navigation';
import { StatusBadge, Pagination, Button, Card } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useExamSessions } from '@/lib/queries/useExamSessions';
import { formatTimeRange } from '@/lib/format-time';
import type { ExamSession } from '@/lib/queries/types';

/**
 * ADMIN "Exam Sessions" — read-only, faculty-lifecycle-ownership change.
 * `GET /exam-sessions` returns EVERY session, unscoped, for ADMIN — this
 * is the "full read-only visibility into every scheduled session" the
 * change requires. There is no "New Exam Session" button here anymore:
 * admin can no longer create/act on sessions (see
 * `apps/web/app/admin/exam-sessions/[id]/page.tsx`, now read-only too).
 */
export default function AdminExamSessionsPage() {
  const router = useRouter();
  const pager = useCursorPager();
  const { data, isLoading, isError, refetch, isFetching } = useExamSessions({ cursor: pager.cursor, limit: 25 });

  const columns: DataTableColumn<ExamSession>[] = [
    { key: 'name', header: 'Name', render: (s) => s.name },
    { key: 'date', header: 'Date', render: (s) => s.sessionDate.slice(0, 10) },
    {
      key: 'time',
      header: 'Time',
      render: (s) => formatTimeRange(s.startTime, s.endTime),
    },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
  ];

  const items = data?.items ?? [];
  // Same split as the faculty "My Exam Sessions" list — a COMPLETED or
  // CANCELLED session is done; keeping it mixed in with sessions still
  // running buries the ones an admin might actually need to check on.
  const isHistorical = (s: ExamSession) => s.status === 'COMPLETED' || s.status === 'CANCELLED';
  const activeSessions = items.filter((s) => !isHistorical(s));
  const historySessions = items.filter(isHistorical);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Exam Sessions</h1>
        <p className="text-sm text-text-muted">
          Every scheduled exam session, across every faculty — read-only. Faculty drive the full lifecycle for their own sessions.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={activeSessions}
        getRowKey={(s) => s.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load exam sessions"
        emptyTitle="No exam sessions scheduled yet"
        renderActions={(s) => (
          <Button size="sm" variant="secondary" onClick={() => router.push(`/admin/exam-sessions/${s.id}`)}>
            View
          </Button>
        )}
      />

      {historySessions.length > 0 && (
        <Card header={<h2 className="text-sm font-semibold text-text">History</h2>} padding="dense">
          <DataTable
            columns={columns}
            data={historySessions}
            getRowKey={(s) => s.id}
            isLoading={false}
            isError={false}
            emptyTitle="No past sessions yet"
            renderActions={(s) => (
              <Button size="sm" variant="secondary" onClick={() => router.push(`/admin/exam-sessions/${s.id}`)}>
                View
              </Button>
            )}
          />
        </Card>
      )}

      {items.length > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}
    </div>
  );
}
