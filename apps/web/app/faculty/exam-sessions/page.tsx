'use client';

import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Card, StatusBadge, Pagination } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useExamSessions } from '@/lib/queries/useExamSessions';
import { formatTimeRange } from '@/lib/format-time';
import type { ExamSession } from '@/lib/queries/types';

/**
 * FACULTY "My Exam Sessions" — added by the faculty-lifecycle-ownership
 * change. `GET /exam-sessions` self-scopes server-side to sessions the
 * calling faculty owns/co-instructs (own/co-instruct at least one
 * currently actively-attached quiz) — same self-scoping convention as
 * "My Quizzes".
 */
export default function FacultyExamSessionsPage() {
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
  // Same split as "My Invigilation Duties" — a session that's COMPLETED
  // or CANCELLED is done, nothing left to act on, and burying it among
  // sessions still in progress makes the ones that DO need attention
  // harder to find. Moved into a read-only History section instead.
  const isHistorical = (s: ExamSession) => s.status === 'COMPLETED' || s.status === 'CANCELLED';
  const activeSessions = items.filter((s) => !isHistorical(s));
  const historySessions = items.filter(isHistorical);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">My Exam Sessions</h1>
          <p className="text-sm text-text-muted">Sessions built from quizzes you own or co-instruct.</p>
        </div>
        <Button onClick={() => router.push('/faculty/exam-sessions/new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New Exam Session
        </Button>
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
        emptyTitle="No exam sessions yet"
        emptyDescription="Create one, then attach one of your approved quizzes to it."
        renderActions={(s) => (
          <Button size="sm" variant="secondary" onClick={() => router.push(`/faculty/exam-sessions/${s.id}`)}>
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
              <Button size="sm" variant="secondary" onClick={() => router.push(`/faculty/exam-sessions/${s.id}`)}>
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
