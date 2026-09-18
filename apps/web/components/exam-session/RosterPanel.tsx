'use client';

import { useState } from 'react';
import {
  Button,
  Alert,
  Modal,
  Select,
  Textarea,
  StatusBadge,
  Pagination,
} from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useExamSessionRoster } from '@/lib/queries/useExamSessionRoster';
import { useStudents } from '@/lib/queries/useStudents';
import {
  useAssignStudents,
  useAddRosterEntry,
  useRemoveRosterEntry,
} from '@/lib/mutations/useStudentAssignmentMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, QuizStudentAssignmentStatus, RosterEntry } from '@/lib/queries/types';

export interface RosterPanelProps {
  session: ExamSessionDetail;
}

const STATUS_OPTIONS: { value: '' | QuizStudentAssignmentStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'WAITLISTED', label: 'Waitlisted' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/**
 * Roster/Student Assignment section: "Assign Students" (bulk, immediate
 * result — the `202` is synchronous-but-chunked, no polling needed), a
 * paginated roster table, manual "Add Student" (quiz picker from this
 * session's attached quizzes + student picker via M4's `useStudents`),
 * and per-row "Remove" requiring a reason (EC-016).
 */
export function RosterPanel({ session }: RosterPanelProps) {
  const pager = useCursorPager();
  const [statusFilter, setStatusFilter] = useState<'' | QuizStudentAssignmentStatus>('');
  const [addOpen, setAddOpen] = useState(false);
  const [addQuizId, setAddQuizId] = useState('');
  const [addStudentId, setAddStudentId] = useState('');
  const [removing, setRemoving] = useState<RosterEntry | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const rosterQuery = useExamSessionRoster(session.id, {
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const studentsQuery = useStudents({ limit: 200, status: 'ACTIVE' });
  const studentById = new Map((studentsQuery.data?.items ?? []).map((s) => [s.id, s]));

  const assignMutation = useAssignStudents(session.id);
  const addMutation = useAddRosterEntry(session.id);
  const removeMutation = useRemoveRosterEntry(session.id);

  async function onAssignStudents() {
    try {
      await assignMutation.mutateAsync();
    } catch {
      // surfaced below via assignMutation.error
    }
  }

  async function onAddStudent() {
    if (!addQuizId || !addStudentId) return;
    try {
      await addMutation.mutateAsync({ studentId: addStudentId, quiz_id: addQuizId });
      setAddOpen(false);
      setAddQuizId('');
      setAddStudentId('');
    } catch {
      // surfaced below via addMutation.error
    }
  }

  async function onConfirmRemove() {
    if (!removing || !removeReason.trim()) return;
    try {
      await removeMutation.mutateAsync({ studentId: removing.studentId, quiz_id: removing.quizId, reason: removeReason });
      setRemoving(null);
      setRemoveReason('');
    } catch {
      // surfaced below via removeMutation.error, keep dialog open
    }
  }

  const columns: DataTableColumn<RosterEntry>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (e) => studentById.get(e.studentId)?.name ?? e.studentId,
    },
    {
      key: 'quiz',
      header: 'Quiz',
      render: (e) => session.quizzes.find((q) => q.id === e.quizId)?.title ?? e.quizId,
    },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
  ];

  const result = assignMutation.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); pager.reset(); }}
          options={STATUS_OPTIONS}
          aria-label="Filter roster by status"
        />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>Add Student</Button>
          <Button size="sm" onClick={onAssignStudents} loading={assignMutation.isPending}>Assign Students</Button>
        </div>
      </div>

      {assignMutation.isError && (
        <Alert color="danger" title="Couldn't assign students">
          {mapError(assignMutation.error).description}
        </Alert>
      )}
      {result && (
        <Alert color={result.failure_count > 0 ? 'warning' : 'success'} title="Assignment complete" dismissible>
          {result.success_count} of {result.total_rows} student(s) assigned successfully.
          {result.failure_count > 0 && ` ${result.failure_count} failed.`}
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={rosterQuery.data?.items ?? []}
        getRowKey={(e) => e.id}
        isLoading={rosterQuery.isLoading}
        isError={rosterQuery.isError}
        onRetry={() => rosterQuery.refetch()}
        retrying={rosterQuery.isFetching}
        errorTitle="Couldn't load the roster"
        emptyTitle="No students on the roster yet"
        emptyDescription="Use Assign Students to run the bulk eligibility-based assignment, or add a student manually."
        renderActions={(e) =>
          e.status !== 'CANCELLED' ? (
            <div className="flex justify-end">
              <Button size="sm" variant="tertiary" onClick={() => setRemoving(e)}>Remove</Button>
            </div>
          ) : null
        }
      />

      {(rosterQuery.data?.items?.length ?? 0) > 0 && (
        <Pagination
          hasNext={!!rosterQuery.data?.next_cursor}
          hasPrev={pager.hasPrev}
          onNext={() => pager.goNext(rosterQuery.data?.next_cursor)}
          onPrev={pager.goPrev}
        />
      )}

      <Modal
        open={addOpen}
        onOpenChange={(next) => { setAddOpen(next); if (!next) addMutation.reset(); }}
        title="Add Student to Roster"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={onAddStudent} disabled={!addQuizId || !addStudentId} loading={addMutation.isPending}>
              Add
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {addMutation.isError && (
            <Alert color="danger" title="Couldn't add student">{mapError(addMutation.error).description}</Alert>
          )}
          <Select
            label="Quiz"
            required
            value={addQuizId}
            onChange={(e) => setAddQuizId(e.target.value)}
            options={session.quizzes.map((q) => ({ value: q.id, label: q.title }))}
            placeholder="Select a quiz"
          />
          <Select
            label="Student"
            required
            value={addStudentId}
            onChange={(e) => setAddStudentId(e.target.value)}
            options={(studentsQuery.data?.items ?? []).map((s) => ({ value: s.id, label: `${s.rollNumber} — ${s.name}` }))}
            placeholder={studentsQuery.isLoading ? 'Loading students…' : 'Select a student'}
          />
        </div>
      </Modal>

      <Modal
        open={!!removing}
        onOpenChange={(next) => { if (!next) { setRemoving(null); setRemoveReason(''); removeMutation.reset(); } }}
        title="Remove student from roster?"
        description={
          removing
            ? `"${studentById.get(removing.studentId)?.name ?? removing.studentId}" will be cancelled from this quiz assignment. This requires a reason.`
            : undefined
        }
        preventDismiss
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={removeMutation.isPending}>Back</Button>
            <Button
              variant="destructive"
              onClick={onConfirmRemove}
              loading={removeMutation.isPending}
              disabled={!removeReason.trim()}
            >
              Remove
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {removeMutation.isError && (
            <Alert color="danger" title="Couldn't remove">{mapError(removeMutation.error).description}</Alert>
          )}
          <Textarea
            label="Reason"
            required
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
            placeholder="Explain why this student is being removed from the roster."
          />
        </div>
      </Modal>
    </div>
  );
}
