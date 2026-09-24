'use client';

import { ClipboardList } from 'lucide-react';
import { Card, EmptyState, SkeletonText, StatusBadge } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useMyFaculty } from '@/lib/queries/useFaculty';
import { useFacultyAssignments } from '@/lib/queries/useFacultyAssignments';
import { useSubjects } from '@/lib/queries/useSubjects';
import { useBatches } from '@/lib/queries/useBatches';
import type { FacultyAssignment } from '@/lib/queries/types';

/**
 * FACULTY "My Assignments" — `GET /faculty/{id}/assignments` is
 * self-or-ADMIN, but needed the caller's own Faculty-row id, which
 * `GET /users/me` never exposed. Resolved via `GET /faculty/me`, same
 * fix as "My Invigilation Duties".
 */
export default function FacultyAssignmentsPage() {
  const myFacultyQuery = useMyFaculty();
  const pager = useCursorPager();
  const assignmentsQuery = useFacultyAssignments(myFacultyQuery.data?.id, { cursor: pager.cursor, limit: 25 });
  const subjectsQuery = useSubjects({ limit: 200 });
  const batchesQuery = useBatches({ limit: 200 });

  const subjectById = new Map((subjectsQuery.data?.items ?? []).map((s) => [s.id, s]));
  const batchById = new Map((batchesQuery.data?.items ?? []).map((b) => [b.id, b]));

  const columns: DataTableColumn<FacultyAssignment>[] = [
    { key: 'subject', header: 'Subject', render: (a) => subjectById.get(a.subjectId)?.name ?? a.subjectId },
    {
      key: 'batch',
      header: 'Batch',
      render: (a) => {
        const b = batchById.get(a.batchId);
        return b ? `${b.section}/${b.subsection} (${b.year})` : a.batchId;
      },
    },
    { key: 'year', header: 'Academic Year', render: (a) => a.academicYear },
    { key: 'semester', header: 'Semester', render: (a) => a.semester },
    { key: 'role', header: 'Role', render: (a) => (a.role === 'PRIMARY_INSTRUCTOR' ? 'Primary Instructor' : 'Co-Instructor') },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.endedAt ? 'INACTIVE' : 'ACTIVE'} /> },
  ];

  const items = assignmentsQuery.data?.items ?? [];
  // Same split used elsewhere for a terminal/ended state — an assignment
  // that's already ENDED is history, not something to act on.
  const activeAssignments = items.filter((a) => !a.endedAt);
  const historyAssignments = items.filter((a) => a.endedAt);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">My Assignments</h1>
        <p className="text-sm text-text-muted">Subjects and batches you&apos;re assigned to teach.</p>
      </div>

      {myFacultyQuery.isLoading ? (
        <Card><SkeletonText lines={4} /></Card>
      ) : myFacultyQuery.isError ? (
        <Card>
          <EmptyState
            icon={<ClipboardList size={28} />}
            title="Not available"
            description="Couldn't resolve your faculty record — an administrator can tell you your current teaching assignments in the meantime."
          />
        </Card>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={activeAssignments}
            getRowKey={(a) => a.id}
            isLoading={assignmentsQuery.isLoading}
            isError={assignmentsQuery.isError}
            onRetry={() => assignmentsQuery.refetch()}
            errorTitle="Couldn't load your assignments"
            emptyTitle="No teaching assignments yet"
            emptyDescription="Subjects and batches assigned to you by an administrator will appear here."
          />

          {historyAssignments.length > 0 && (
            <Card header={<h2 className="text-sm font-semibold text-text">History</h2>} padding="dense">
              <DataTable
                columns={columns}
                data={historyAssignments}
                getRowKey={(a) => a.id}
                isLoading={false}
                isError={false}
                emptyTitle="No ended assignments yet"
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
