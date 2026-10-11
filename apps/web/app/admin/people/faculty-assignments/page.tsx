'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Card,
  Select,
  Input,
  Checkbox,
  Modal,
  ConfirmationDialog,
  FormField,
  StatusBadge,
  Alert,
  EmptyState,
  SkeletonText,
} from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useFaculty } from '@/lib/queries/useFaculty';
import { useSubjects } from '@/lib/queries/useSubjects';
import { useBatches } from '@/lib/queries/useBatches';
import { useFacultyAssignments } from '@/lib/queries/useFacultyAssignments';
import {
  useBulkAssignFaculty,
  useBulkImportFacultyAssignments,
  useEndFacultyAssignment,
  downloadFacultyAssignmentTemplate,
} from '@/lib/mutations/useFacultyAssignmentMutations';
import { fetchImportJob } from '@/lib/mutations/useStudentMutations';
import { BulkImportModal } from '@/components/bulk-import/BulkImportModal';
import { mapError } from '@/lib/error-mapping';
import type { FacultyAssignment } from '@/lib/queries/types';

const assignmentSchema = z.object({
  subject_id: z.string().uuid('Select a subject.'),
  batch_ids: z.array(z.string().uuid()).min(1, 'Select at least one batch.'),
  academic_year: z.string().min(1, 'Academic year is required.'),
  semester: z.coerce.number().int().min(1, 'Semester must be at least 1.'),
  role: z.enum(['PRIMARY_INSTRUCTOR', 'CO_INSTRUCTOR']),
});
type AssignmentFormValues = z.infer<typeof assignmentSchema>;

/**
 * Faculty Assignments — no `GET /faculty-assignments` list endpoint exists
 * on the real backend (verified: the only list route is scoped, per-
 * faculty, `GET /faculty/{id}/assignments`). Faculty (M4) has no per-row
 * detail view to hang this off of, so this is a small dedicated page: pick
 * a faculty member first, then manage their teaching assignments — the
 * closest real equivalent of "open a faculty member -> see their
 * assignments" the existing app structure supports.
 */
export default function FacultyAssignmentsPage() {
  const [facultyId, setFacultyId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [ending, setEnding] = useState<FacultyAssignment | null>(null);

  const facultyQuery = useFaculty({ all: true, status: 'ACTIVE' });
  const allFaculty = facultyQuery.data?.items ?? [];
  const subjectsQuery = useSubjects({ all: true, isActive: true });
  const batchesQuery = useBatches({ all: true, status: 'ACTIVE' });
  const assignmentsQuery = useFacultyAssignments(facultyId || undefined, { all: true });

  const subjectById = new Map((subjectsQuery.data?.items ?? []).map((s) => [s.id, s]));
  const batchById = new Map((batchesQuery.data?.items ?? []).map((b) => [b.id, b]));

  const bulkAssignMutation = useBulkAssignFaculty();
  const bulkImportMutation = useBulkImportFacultyAssignments();
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [facultySearch, setFacultySearch] = useState('');
  const endMutation = useEndFacultyAssignment(facultyId);

  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: { subject_id: '', batch_ids: [], academic_year: '', semester: 1, role: 'PRIMARY_INSTRUCTOR' },
  });

  async function onSubmit(values: AssignmentFormValues) {
    const { batch_ids, ...rest } = values;
    // Each batch is its own independent assignment row on the backend (each
    // has its own lifecycle, e.g. "End" one batch without affecting the
    // others), sent as ONE bulk request — one bad row (e.g. a duplicate)
    // never blocks the rest, and each failure comes back with its own message.
    let job;
    try {
      job = await bulkAssignMutation.mutateAsync(
        batch_ids.map((batch_id) => ({ faculty_id: facultyId, batch_id, ...rest })),
      );
    } catch (err) {
      form.setError('root', { message: mapError(err).description });
      return;
    }

    // Results come back in request order (row i+1 <-> batch_ids[i]).
    const failures = job.results
      .filter((r) => r.status === 'FAILURE')
      .map((r) => ({ batchId: batch_ids[r.row - 1], error: r.error ?? 'Unknown error' }));

    if (failures.length === 0) {
      setAddOpen(false);
      setBatchSearch('');
      form.reset({ subject_id: '', batch_ids: [], academic_year: '', semester: 1, role: 'PRIMARY_INSTRUCTOR' });
      return;
    }

    const failureLines = failures.map(({ batchId, error }) => {
      const b = batchById.get(batchId);
      return `${b ? `${b.section}/${b.subsection}` : batchId}: ${error}`;
    });
    form.setError('root', {
      message:
        job.successCount > 0
          ? `Assigned ${job.successCount} of ${job.totalRows} batch(es). Failed — ${failureLines.join('; ')}`
          : `Could not create the assignment — ${failureLines.join('; ')}`,
    });
    // Keep only the failed batches selected, so retrying resubmits just those.
    form.setValue('batch_ids', failures.map((f) => f.batchId));
  }

  async function confirmEnd() {
    if (!ending) return;
    await endMutation.mutateAsync(ending.id);
    setEnding(null);
  }

  const columns: DataTableColumn<FacultyAssignment>[] = [
    { key: 'subject', header: 'Subject', render: (a) => subjectById.get(a.subjectId)?.name ?? a.subjectId },
    {
      key: 'batch',
      header: 'Batch',
      render: (a) => (batchById.get(a.batchId) ? `${batchById.get(a.batchId)!.section}/${batchById.get(a.batchId)!.subsection} (${batchById.get(a.batchId)!.year})` : a.batchId),
    },
    { key: 'year', header: 'Academic Year', render: (a) => a.academicYear },
    { key: 'semester', header: 'Semester', render: (a) => a.semester },
    { key: 'role', header: 'Role', render: (a) => (a.role === 'PRIMARY_INSTRUCTOR' ? 'Primary Instructor' : 'Co-Instructor') },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.endedAt ? 'INACTIVE' : 'ACTIVE'} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  const assignmentItems = assignmentsQuery.data?.items ?? [];
  // Same split used elsewhere for a terminal/ended state — an assignment
  // that's already ENDED is history, not something to act on.
  const activeAssignments = assignmentItems.filter((a) => !a.endedAt);
  const historyAssignments = assignmentItems.filter((a) => a.endedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Faculty Assignments</h1>
          <p className="text-sm text-text-muted">Manage which faculty member teaches which subject/batch, and when.</p>
        </div>
        <Button variant="secondary" leadingIcon={<Upload size={16} aria-hidden="true" />} onClick={() => setBulkImportOpen(true)}>
          Bulk Import
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Input
          aria-label="Search faculty"
          placeholder="Search faculty by name or employee code…"
          value={facultySearch}
          onChange={(e) => setFacultySearch(e.target.value)}
        />
        <Select
          label="Faculty member"
          value={facultyId}
          onChange={(e) => setFacultyId(e.target.value)}
          options={allFaculty
            .filter(
              (f) =>
                f.id === facultyId ||
                `${f.employeeCode} ${f.name}`.toLowerCase().includes(facultySearch.trim().toLowerCase()),
            )
            .map((f) => ({ value: f.id, label: `${f.employeeCode} — ${f.name}` }))}
          placeholder={
            facultyQuery.isLoading
              ? 'Loading faculty…'
              : `Select a faculty member (${allFaculty.length} ${allFaculty.length === 1 ? 'person' : 'people'})`
          }
        />
      </div>

      {!facultyId ? (
        <EmptyState title="Select a faculty member" description="Choose a faculty member above to view and manage their teaching assignments." />
      ) : (
        <>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddOpen(true)}>Add Assignment</Button>
          </div>

          {assignmentsQuery.isLoading ? (
            <SkeletonText lines={4} />
          ) : (
            <>
              <DataTable
                columns={columns}
                data={activeAssignments}
                getRowKey={(a) => a.id}
                isLoading={assignmentsQuery.isLoading}
                isError={assignmentsQuery.isError}
                onRetry={() => assignmentsQuery.refetch()}
                retrying={assignmentsQuery.isFetching}
                errorTitle="Couldn't load teaching assignments"
                emptyTitle="No teaching assignments"
                emptyDescription="This faculty member has no recorded teaching assignments yet."
                emptyAction={<Button size="sm" onClick={() => setAddOpen(true)}>Add Assignment</Button>}
                renderActions={(a) => (
                  <div className="flex justify-end">
                    <Button size="sm" variant="tertiary" onClick={() => setEnding(a)}>End</Button>
                  </div>
                )}
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
        </>
      )}

      <Modal
        open={addOpen}
        onOpenChange={(next) => { setAddOpen(next); if (!next) { bulkAssignMutation.reset(); setBatchSearch(''); } }}
        title="Add Teaching Assignment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit(onSubmit)} loading={bulkAssignMutation.isPending}>Add</Button>
          </>
        }
      >
        <FormProvider {...form}>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            {rootError && <Alert color="danger">{rootError}</Alert>}
            <FormField<AssignmentFormValues> name="subject_id" label="Subject" required>
              {(field) => (
                <Select
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  options={(subjectsQuery.data?.items ?? []).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
                  placeholder="Select a subject"
                />
              )}
            </FormField>
            <Controller
              name="batch_ids"
              control={form.control}
              render={({ field, fieldState }) => {
                const allBatches = batchesQuery.data?.items ?? [];
                const q = batchSearch.trim().toLowerCase();
                const batches = allBatches.filter((b) =>
                  `${b.year} ${b.section} ${b.subsection}`.toLowerCase().includes(q),
                );
                const selected = field.value as string[];
                const allVisibleSelected = batches.length > 0 && batches.every((b) => selected.includes(b.id));
                return (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text">
                        Batches <span className="text-danger-text">*</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-text-muted">
                        {selected.length} selected
                        {selected.length > 0 && (
                          <button type="button" className="text-primary-700 hover:underline" onClick={() => field.onChange([])}>
                            Clear
                          </button>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted">
                      Select one or more batches — a separate assignment is created for each.
                    </p>
                    <Input
                      aria-label="Search batches"
                      placeholder="Search by year, section or subsection…"
                      value={batchSearch}
                      onChange={(e) => setBatchSearch(e.target.value)}
                    />
                    {batches.length > 0 && (
                      <Checkbox
                        label={q ? `Select all matching (${batches.length})` : `Select all (${batches.length})`}
                        checked={allVisibleSelected}
                        onChange={() => {
                          const visibleIds = batches.map((b) => b.id);
                          field.onChange(
                            allVisibleSelected
                              ? selected.filter((id) => !visibleIds.includes(id))
                              : [...new Set([...selected, ...visibleIds])],
                          );
                        }}
                      />
                    )}
                    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
                      {batches.length === 0 && (
                        <p className="text-sm text-text-muted">{allBatches.length === 0 ? 'No active batches available.' : 'No batches match.'}</p>
                      )}
                      {batches.map((b) => {
                        const checked = selected.includes(b.id);
                        return (
                          <Checkbox
                            key={b.id}
                            label={`${b.section}/${b.subsection} (${b.year})`}
                            checked={checked}
                            onChange={(e) => {
                              field.onChange(
                                e.target.checked ? [...selected, b.id] : selected.filter((id) => id !== b.id),
                              );
                            }}
                          />
                        );
                      })}
                    </div>
                    {fieldState.error && (
                      <p role="alert" className="text-xs text-danger-text">
                        {fieldState.error.message}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <FormField<AssignmentFormValues> name="academic_year" label="Academic Year" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} placeholder="e.g. 2025-2026" />}
            </FormField>
            <FormField<AssignmentFormValues> name="semester" label="Semester" required>
              {(field) => <Input type="number" min={1} {...field} value={(field.value as number) ?? 1} onChange={(e) => field.onChange(e.target.valueAsNumber)} />}
            </FormField>
            <FormField<AssignmentFormValues> name="role" label="Role" required>
              {(field) => (
                <Select
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  options={[
                    { value: 'PRIMARY_INSTRUCTOR', label: 'Primary Instructor' },
                    { value: 'CO_INSTRUCTOR', label: 'Co-Instructor' },
                  ]}
                />
              )}
            </FormField>
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!ending}
        onOpenChange={(open) => !open && setEnding(null)}
        title="End this teaching assignment?"
        description="This assignment will be marked ended. It is a soft end — the historical record is kept, not deleted."
        confirmLabel="End Assignment"
        destructive
        loading={endMutation.isPending}
        onConfirm={confirmEnd}
      />

      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        entityLabel="Faculty Assignment"
        onDownloadTemplate={downloadFacultyAssignmentTemplate}
        onUpload={(file) => bulkImportMutation.mutateAsync(file)}
        onPollJob={fetchImportJob}
      />
    </div>
  );
}
