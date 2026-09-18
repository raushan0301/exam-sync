'use client';

import { useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Select,
  Input,
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
import { useCreateFacultyAssignment, useEndFacultyAssignment } from '@/lib/mutations/useFacultyAssignmentMutations';
import { mapError } from '@/lib/error-mapping';
import type { FacultyAssignment } from '@/lib/queries/types';

const assignmentSchema = z.object({
  subject_id: z.string().uuid('Select a subject.'),
  batch_id: z.string().uuid('Select a batch.'),
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

  const facultyQuery = useFaculty({ limit: 200, status: 'ACTIVE' });
  const subjectsQuery = useSubjects({ limit: 200, isActive: true });
  const batchesQuery = useBatches({ limit: 200, status: 'ACTIVE' });
  const assignmentsQuery = useFacultyAssignments(facultyId || undefined, { limit: 50 });

  const subjectById = new Map((subjectsQuery.data?.items ?? []).map((s) => [s.id, s]));
  const batchById = new Map((batchesQuery.data?.items ?? []).map((b) => [b.id, b]));

  const createMutation = useCreateFacultyAssignment();
  const endMutation = useEndFacultyAssignment(facultyId);

  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: { subject_id: '', batch_id: '', academic_year: '', semester: 1, role: 'PRIMARY_INSTRUCTOR' },
  });

  async function onSubmit(values: AssignmentFormValues) {
    try {
      await createMutation.mutateAsync({ faculty_id: facultyId, ...values });
      setAddOpen(false);
      form.reset({ subject_id: '', batch_id: '', academic_year: '', semester: 1, role: 'PRIMARY_INSTRUCTOR' });
    } catch (err) {
      const mapped = mapError(err);
      form.setError('root', { message: mapped.description });
    }
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
      render: (a) => (batchById.get(a.batchId) ? `${batchById.get(a.batchId)!.section} (${batchById.get(a.batchId)!.year})` : a.batchId),
    },
    { key: 'year', header: 'Academic Year', render: (a) => a.academicYear },
    { key: 'semester', header: 'Semester', render: (a) => a.semester },
    { key: 'role', header: 'Role', render: (a) => (a.role === 'PRIMARY_INSTRUCTOR' ? 'Primary Instructor' : 'Co-Instructor') },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.endedAt ? 'INACTIVE' : 'ACTIVE'} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Faculty Assignments</h1>
        <p className="text-sm text-text-muted">Manage which faculty member teaches which subject/batch, and when.</p>
      </div>

      <Select
        label="Faculty member"
        value={facultyId}
        onChange={(e) => setFacultyId(e.target.value)}
        options={(facultyQuery.data?.items ?? []).map((f) => ({ value: f.id, label: `${f.employeeCode} — ${f.name}` }))}
        placeholder={facultyQuery.isLoading ? 'Loading faculty…' : 'Select a faculty member'}
      />

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
            <DataTable
              columns={columns}
              data={assignmentsQuery.data?.items ?? []}
              getRowKey={(a) => a.id}
              isLoading={assignmentsQuery.isLoading}
              isError={assignmentsQuery.isError}
              onRetry={() => assignmentsQuery.refetch()}
              retrying={assignmentsQuery.isFetching}
              errorTitle="Couldn't load teaching assignments"
              emptyTitle="No teaching assignments"
              emptyDescription="This faculty member has no recorded teaching assignments yet."
              emptyAction={<Button size="sm" onClick={() => setAddOpen(true)}>Add Assignment</Button>}
              renderActions={(a) =>
                !a.endedAt ? (
                  <div className="flex justify-end">
                    <Button size="sm" variant="tertiary" onClick={() => setEnding(a)}>End</Button>
                  </div>
                ) : null
              }
            />
          )}
        </>
      )}

      <Modal
        open={addOpen}
        onOpenChange={(next) => { setAddOpen(next); if (!next) createMutation.reset(); }}
        title="Add Teaching Assignment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit(onSubmit)} loading={createMutation.isPending}>Add</Button>
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
            <FormField<AssignmentFormValues> name="batch_id" label="Batch" required>
              {(field) => (
                <Select
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  options={(batchesQuery.data?.items ?? []).map((b) => ({ value: b.id, label: `${b.section} (${b.year})` }))}
                  placeholder="Select a batch"
                />
              )}
            </FormField>
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
    </div>
  );
}
