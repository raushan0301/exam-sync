'use client';

import { useRouter } from 'next/navigation';
import { Button, StatusBadge } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useQuizzes } from '@/lib/queries/useQuizzes';
import { useSubjects } from '@/lib/queries/useSubjects';
import type { Quiz } from '@/lib/queries/types';

/**
 * ADMIN "Approval Queue" — quiz list pre-filtered server-side to
 * `status=SUBMITTED`. Row click goes to the same quiz detail page as
 * "All Quizzes," which already renders Approve/Reject for ADMIN when the
 * quiz is SUBMITTED.
 */
export default function ApprovalQueuePage() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isFetching } = useQuizzes({ status: 'SUBMITTED', all: true });
  const { data: subjectsData } = useSubjects({ all: true });
  const subjectById = new Map((subjectsData?.items ?? []).map((s) => [s.id, s]));

  const columns: DataTableColumn<Quiz>[] = [
    { key: 'title', header: 'Title', render: (q) => q.title },
    { key: 'subject', header: 'Subject', render: (q) => subjectById.get(q.subjectId)?.name ?? q.subjectId },
    { key: 'status', header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
    { key: 'term', header: 'Year / Semester', render: (q) => `${q.academicYear} / Sem ${q.semester}` },
    { key: 'updatedAt', header: 'Submitted', render: (q) => new Date(q.updatedAt).toLocaleDateString() },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Approval Queue</h1>
        <p className="text-sm text-text-muted">Quizzes awaiting your review.</p>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        getRowKey={(q) => q.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load the approval queue"
        emptyTitle="Nothing waiting on you"
        emptyDescription="All submitted quizzes have been reviewed. New submissions will appear here."
        renderActions={(q) => (
          <Button size="sm" onClick={() => router.push(`/admin/quizzes/${q.id}`)}>
            Review
          </Button>
        )}
      />
    </div>
  );
}
