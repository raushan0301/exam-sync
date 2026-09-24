'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge, Select, FilterBar, Pagination, Button, Card } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useQuizzes } from '@/lib/queries/useQuizzes';
import { useSubjects } from '@/lib/queries/useSubjects';
import type { Quiz, QuizStatus } from '@/lib/queries/types';

const STATUS_OPTIONS: { value: '' | QuizStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

/**
 * ADMIN "All Quizzes" — GET /quizzes returns every quiz for ADMIN (no
 * self-scoping), optionally filtered by `status`. No search UI: the
 * controller does not accept a `search` param.
 */
export default function AdminQuizzesPage() {
  const router = useRouter();
  const pager = useCursorPager();
  const [statusFilter, setStatusFilter] = useState<'' | QuizStatus>('');

  const { data, isLoading, isError, refetch, isFetching } = useQuizzes({
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const { data: subjectsData } = useSubjects({ limit: 200 });
  const subjectById = new Map((subjectsData?.items ?? []).map((s) => [s.id, s]));

  const columns: DataTableColumn<Quiz>[] = [
    { key: 'title', header: 'Title', render: (q) => q.title },
    { key: 'subject', header: 'Subject', render: (q) => subjectById.get(q.subjectId)?.name ?? q.subjectId },
    { key: 'status', header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
    {
      key: 'session',
      header: 'Exam Session',
      render: (q) =>
        q.examSession ? (
          <Link href={`/admin/exam-sessions/${q.examSession.id}`} className="flex items-center gap-2 text-primary-600 hover:underline">
            <StatusBadge status={q.examSession.status} />
          </Link>
        ) : (
          <span className="text-text-muted">Not scheduled</span>
        ),
    },
    { key: 'term', header: 'Year / Semester', render: (q) => `${q.academicYear} / Sem ${q.semester}` },
    { key: 'updatedAt', header: 'Updated', render: (q) => new Date(q.updatedAt).toLocaleDateString() },
  ];

  const items = data?.items ?? [];
  // Same split as the faculty "My Quizzes" list — once the quiz's own
  // exam session is COMPLETED or CANCELLED, there's nothing left to act
  // on for it.
  const isHistorical = (q: Quiz) => q.examSession?.status === 'COMPLETED' || q.examSession?.status === 'CANCELLED';
  const activeQuizzes = items.filter((q) => !isHistorical(q));
  const historyQuizzes = items.filter(isHistorical);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">All Quizzes</h1>
        <p className="text-sm text-text-muted">Every quiz across all faculty, with its current lifecycle status.</p>
      </div>

      <FilterBar>
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as typeof statusFilter);
            pager.reset();
          }}
          options={STATUS_OPTIONS}
          aria-label="Filter by status"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={activeQuizzes}
        getRowKey={(q) => q.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load quizzes"
        emptyTitle="No quizzes found"
        emptyDescription={statusFilter ? 'Try clearing the status filter.' : 'No quizzes have been created yet.'}
        renderActions={(q) => (
          <Button size="sm" variant="secondary" onClick={() => router.push(`/admin/quizzes/${q.id}`)}>
            View
          </Button>
        )}
      />

      {historyQuizzes.length > 0 && (
        <Card header={<h2 className="text-sm font-semibold text-text">History</h2>} padding="dense">
          <DataTable
            columns={columns}
            data={historyQuizzes}
            getRowKey={(q) => q.id}
            isLoading={false}
            isError={false}
            emptyTitle="No past quizzes yet"
            renderActions={(q) => (
              <Button size="sm" variant="secondary" onClick={() => router.push(`/admin/quizzes/${q.id}`)}>
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
