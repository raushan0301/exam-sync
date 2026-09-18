'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, StatusBadge, Select, FilterBar, Pagination } from '@/components/ui';
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
  const { data: subjectsData } = useSubjects({ limit: 200 });
  const subjectById = new Map((subjectsData?.items ?? []).map((s) => [s.id, s]));

  const columns: DataTableColumn<Quiz>[] = [
    { key: 'title', header: 'Title', render: (q) => q.title },
    { key: 'subject', header: 'Subject', render: (q) => subjectById.get(q.subjectId)?.name ?? q.subjectId },
    { key: 'status', header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
    { key: 'term', header: 'Year / Semester', render: (q) => `${q.academicYear} / Sem ${q.semester}` },
    { key: 'updatedAt', header: 'Updated', render: (q) => new Date(q.updatedAt).toLocaleDateString() },
  ];

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
        data={data?.items ?? []}
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

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}
    </div>
  );
}
