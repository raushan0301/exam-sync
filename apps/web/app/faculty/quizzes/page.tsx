'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card, StatusBadge, Select, FilterBar, Pagination } from '@/components/ui';
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
 * FACULTY "My Quizzes" — GET /quizzes self-scopes server-side to quizzes
 * the calling faculty owns or co-instructs (BR-046); no client-side
 * search UI since the controller does not accept a `search` param
 * (verified: quizzes.controller.ts lists only cursor/limit/status/
 * subject_id/faculty_id).
 */
export default function FacultyQuizzesPage() {
  const router = useRouter();
  const pager = useCursorPager();
  const [statusFilter, setStatusFilter] = useState<'' | QuizStatus>('');

  const { data, isLoading, isError, refetch, isFetching } = useQuizzes({
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const { data: subjectsData } = useSubjects({ all: true });
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
          <Link href={`/faculty/exam-sessions/${q.examSession.id}`} className="flex items-center gap-2 text-primary-600 hover:underline">
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
  // Same split already used for "My Exam Sessions" and "My Invigilation
  // Duties" — once the quiz's own exam session is COMPLETED or
  // CANCELLED, there's nothing left to act on for it. A quiz with no
  // exam session yet (or one still in progress) stays in the active list.
  const isHistorical = (q: Quiz) => q.examSession?.status === 'COMPLETED' || q.examSession?.status === 'CANCELLED';
  const activeQuizzes = items.filter((q) => !isHistorical(q));
  const historyQuizzes = items.filter(isHistorical);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">My Quizzes</h1>
          <p className="text-sm text-text-muted">Create, edit, and track your quizzes through approval.</p>
        </div>
        <Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={() => router.push('/faculty/quizzes/new')}>
          New Quiz
        </Button>
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
        emptyTitle="No quizzes yet"
        emptyDescription={statusFilter ? 'Try clearing the status filter.' : 'Create your first quiz to get started.'}
        emptyAction={<Button size="sm" onClick={() => router.push('/faculty/quizzes/new')}>New Quiz</Button>}
        renderActions={(q) => (
          <Button size="sm" variant="secondary" onClick={() => router.push(`/faculty/quizzes/${q.id}`)}>
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
              <Button size="sm" variant="secondary" onClick={() => router.push(`/faculty/quizzes/${q.id}`)}>
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
