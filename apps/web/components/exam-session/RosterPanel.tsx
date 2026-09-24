'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Alert,
  Modal,
  Select,
  Checkbox,
  Textarea,
  StatusBadge,
  Pagination,
  LoadingState,
  EmptyState,
} from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useExamSessionRoster } from '@/lib/queries/useExamSessionRoster';
import { useStudentsForBatches } from '@/lib/queries/useStudents';
import { useBatches } from '@/lib/queries/useBatches';
import {
  useAssignStudents,
  useAddRosterEntry,
  useRemoveRosterEntry,
} from '@/lib/mutations/useStudentAssignmentMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, QuizStudentAssignmentStatus, RosterEntry } from '@/lib/queries/types';

export interface RosterPanelProps {
  session: ExamSessionDetail;
  /** Faculty-lifecycle-ownership change: ADMIN is now read-only for scheduling data — pass `true` to hide Assign/Add/Remove actions, keeping only the roster table itself. */
  readOnly?: boolean;
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
export function RosterPanel({ session, readOnly = false }: RosterPanelProps) {
  // `assignStudents` is a one-shot, DRAFT-only bulk action — the backend
  // always advances DRAFT -> ASSIGNING_STUDENTS once it runs (even with 0
  // eligible students), and 409s every time afterward
  // (student-assignment.service.ts's own idempotency guard at the session
  // level). Manual "Add Student" has no such restriction (only CANCELLED
  // blocks it) and stays available past this point.
  const canBulkAssign = session.status === 'DRAFT';
  const pager = useCursorPager();
  const [statusFilter, setStatusFilter] = useState<'' | QuizStudentAssignmentStatus>('');
  const [addOpen, setAddOpen] = useState(false);
  const [addQuizId, setAddQuizId] = useState('');
  const [addBatchIds, setAddBatchIds] = useState<Set<string>>(new Set());
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addSummary, setAddSummary] = useState<{ success: number; failure: number; error?: string } | null>(null);
  const [removing, setRemoving] = useState<RosterEntry | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const rosterQuery = useExamSessionRoster(session.id, {
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const batchesQuery = useBatches({ status: 'ACTIVE', limit: 200 });
  // Section/subsection roster picker: students are only fetched (and only
  // selectable) once at least one batch/section is chosen, scoped
  // server-side per batch — picking one student at a time out of every
  // active student in the university doesn't scale, so faculty pick one or
  // more of their sections first, then multi-select from the combined
  // roster of just those sections (`useStudentsForBatches` runs one
  // GET /students?batch_id=... per selected section, in parallel).
  const sectionStudentsQuery = useStudentsForBatches(Array.from(addBatchIds));

  const assignMutation = useAssignStudents(session.id);
  const addMutation = useAddRosterEntry(session.id);
  const removeMutation = useRemoveRosterEntry(session.id);

  // `useMutation`'s local result/error state lives on this component's own
  // fiber, not keyed by `session.id` — if the same `RosterPanel` instance
  // survives a client-side navigation from one exam session's page to
  // another (Next.js reuses the fiber at the same tree position rather
  // than remounting), a stale "N of N assigned successfully" from the
  // PREVIOUS session would otherwise still render here, contradicting an
  // actually-empty roster on the new one. Reset every mutation's leftover
  // result/error whenever the session being viewed changes.
  useEffect(() => {
    assignMutation.reset();
    addMutation.reset();
    removeMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  async function onAssignStudents() {
    try {
      await assignMutation.mutateAsync();
    } catch {
      // surfaced below via assignMutation.error
    }
  }

  function toggleBatch(batchId: string) {
    setAddBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
    // A student removed from the picker by narrowing the section selection
    // shouldn't stay silently checked — drop selections outside the new set.
    setSelectedStudentIds(new Set());
  }

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function toggleSelectAll(studentIds: string[]) {
    setSelectedStudentIds((prev) => {
      const allSelected = studentIds.length > 0 && studentIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(studentIds);
    });
  }

  function resetAddModal() {
    setAddQuizId('');
    setAddBatchIds(new Set());
    setSelectedStudentIds(new Set());
    setAddSummary(null);
    addMutation.reset();
  }

  async function onAddStudents() {
    if (!addQuizId || selectedStudentIds.size === 0) return;
    setAddSubmitting(true);
    setAddSummary(null);
    const ids = Array.from(selectedStudentIds);
    const results = await Promise.allSettled(
      ids.map((studentId) => addMutation.mutateAsync({ studentId, quiz_id: addQuizId })),
    );
    setAddSubmitting(false);
    const success = results.filter((r) => r.status === 'fulfilled').length;
    const failure = results.length - success;
    if (failure > 0) {
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      setAddSummary({ success, failure, error: firstFailure ? mapError(firstFailure.reason).description : undefined });
    } else {
      setAddSummary({ success, failure });
      setSelectedStudentIds(new Set());
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
      render: (e) => e.studentName,
    },
    {
      key: 'quiz',
      header: 'Quiz',
      render: (e) => e.quizTitle,
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
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>Add Student</Button>
            {canBulkAssign && (
              <Button size="sm" onClick={onAssignStudents} loading={assignMutation.isPending}>Assign Students</Button>
            )}
          </div>
        )}
      </div>

      {!readOnly && !canBulkAssign && (
        <p className="text-sm text-text-muted">
          Bulk student assignment has already run for this session — use Add Student for any further changes.
        </p>
      )}

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
        emptyDescription={
          canBulkAssign
            ? 'Use Assign Students to run the bulk eligibility-based assignment, or add a student manually.'
            : 'No students were eligible when bulk assignment ran. Add a student manually if needed.'
        }
        renderActions={
          readOnly
            ? undefined
            : (e) =>
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
        onOpenChange={(next) => { setAddOpen(next); if (!next) resetAddModal(); }}
        title="Add Students to Roster"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Close</Button>
            <Button
              onClick={onAddStudents}
              disabled={!addQuizId || selectedStudentIds.size === 0}
              loading={addSubmitting}
            >
              Add {selectedStudentIds.size > 0 ? `${selectedStudentIds.size} ` : ''}Selected
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {addSummary && (
            <Alert color={addSummary.failure > 0 ? 'warning' : 'success'} title="Add complete" dismissible>
              {addSummary.success} student(s) added successfully.
              {addSummary.failure > 0 && ` ${addSummary.failure} failed${addSummary.error ? ` (${addSummary.error})` : ''}.`}
            </Alert>
          )}

          <Select
            label="Quiz"
            required
            value={addQuizId}
            onChange={(e) => setAddQuizId(e.target.value)}
            options={session.quizzes.map((q) => ({ value: q.id, label: q.title }))}
            placeholder="Select a quiz"
          />

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text">
              Section(s) / Batch(es) <span className="text-danger-text">*</span>
            </span>
            {batchesQuery.isLoading ? (
              <LoadingState label="Loading sections…" />
            ) : (batchesQuery.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No sections found" />
            ) : (
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
                {batchesQuery.data!.items.map((b) => (
                  <Checkbox
                    key={b.id}
                    label={`${b.year} · ${b.section}-${b.subsection}`}
                    checked={addBatchIds.has(b.id)}
                    onChange={() => toggleBatch(b.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {addBatchIds.size > 0 && (
            <div className="flex flex-col gap-2">
              {sectionStudentsQuery.isLoading ? (
                <LoadingState label="Loading students in the selected section(s)…" />
              ) : sectionStudentsQuery.items.length === 0 ? (
                <EmptyState title="No students in the selected section(s)" description="Pick different sections, or check the enrollment data." />
              ) : (
                <>
                  <Checkbox
                    label={`Select all (${sectionStudentsQuery.items.length})`}
                    checked={sectionStudentsQuery.items.every((s) => selectedStudentIds.has(s.id))}
                    onChange={() => toggleSelectAll(sectionStudentsQuery.items.map((s) => s.id))}
                  />
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
                    {sectionStudentsQuery.items.map((s) => (
                      <Checkbox
                        key={s.id}
                        label={`${s.rollNumber} — ${s.name}`}
                        checked={selectedStudentIds.has(s.id)}
                        onChange={() => toggleStudent(s.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!removing}
        onOpenChange={(next) => { if (!next) { setRemoving(null); setRemoveReason(''); removeMutation.reset(); } }}
        title="Remove student from roster?"
        description={
          removing
            ? `"${removing.studentName}" will be cancelled from this quiz assignment. This requires a reason.`
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
