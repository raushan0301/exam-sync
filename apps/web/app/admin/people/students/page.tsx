'use client';

import { useEffect, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Upload } from 'lucide-react';
import {
  Button,
  Input,
  Search,
  FilterBar,
  Select,
  Modal,
  ConfirmationDialog,
  FormField,
  StatusBadge,
  Alert,
  Pagination,
} from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { BulkImportModal } from '@/components/bulk-import/BulkImportModal';
import { useStudents } from '@/lib/queries/useStudents';
import { usePrograms } from '@/lib/queries/usePrograms';
import { useBatches } from '@/lib/queries/useBatches';
import {
  useCreateStudent,
  useUpdateStudent,
  useBulkImportStudents,
  downloadStudentTemplate,
  fetchImportJob,
} from '@/lib/mutations/useStudentMutations';
import { mapError } from '@/lib/error-mapping';
import type { Student } from '@/lib/queries/types';

const studentSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('Enter a valid email address.'),
  program_id: z.string().uuid('Select a program.'),
  batch_id: z.string().uuid('Select a batch.'),
  roll_number: z.string().min(1, 'Roll number is required.'),
});
type StudentFormValues = z.infer<typeof studentSchema>;

const editStudentSchema = studentSchema.omit({ email: true });
type EditStudentFormValues = z.infer<typeof editStudentSchema>;

export default function StudentsPage() {
  const pager = useCursorPager();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [deactivating, setDeactivating] = useState<Student | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useStudents({
    search,
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const { data: programsData } = usePrograms({ all: true, status: 'ACTIVE' });
  const { data: batchesData } = useBatches({ all: true, status: 'ACTIVE' });
  const programOptions = (programsData?.items ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  const batchOptions = (batchesData?.items ?? []).map((b) => ({ value: b.id, label: `${b.section}/${b.subsection} (${b.year})` }));
  const programById = new Map((programsData?.items ?? []).map((p) => [p.id, p]));
  const batchById = new Map((batchesData?.items ?? []).map((b) => [b.id, b]));

  const createMutation = useCreateStudent();
  const updateMutation = useUpdateStudent(editing?.id ?? '');
  const deactivateMutation = useUpdateStudent(deactivating?.id ?? '');
  const bulkImportMutation = useBulkImportStudents();

  const createForm = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: { name: '', email: '', program_id: '', batch_id: '', roll_number: '' },
  });
  const editForm = useForm<EditStudentFormValues>({
    resolver: zodResolver(editStudentSchema),
    defaultValues: { name: '', program_id: '', batch_id: '', roll_number: '' },
  });
  const form = editing ? editForm : createForm;

  useEffect(() => {
    if (modalOpen && editing) {
      editForm.reset({
        name: editing.name,
        program_id: editing.programId,
        batch_id: editing.batchId,
        roll_number: editing.rollNumber,
      });
    } else if (modalOpen && !editing) {
      createForm.reset({ name: '', email: '', program_id: '', batch_id: '', roll_number: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(s: Student) {
    setEditing(s);
    setModalOpen(true);
  }

  async function onSubmit(values: StudentFormValues | EditStudentFormValues) {
    try {
      if (editing) {
        await updateMutation.mutateAsync(values as EditStudentFormValues);
      } else {
        await createMutation.mutateAsync(values as StudentFormValues);
      }
      setModalOpen(false);
    } catch (err) {
      const mapped = mapError(err);
      form.setError('root', { message: mapped.description });
    }
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    await deactivateMutation.mutateAsync({ status: deactivating.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
    setDeactivating(null);
  }

  const columns: DataTableColumn<Student>[] = [
    { key: 'rollNumber', header: 'Roll No.', render: (s) => <span className="font-mono text-xs">{s.rollNumber}</span> },
    { key: 'name', header: 'Name', render: (s) => s.name },
    { key: 'program', header: 'Program', render: (s) => programById.get(s.programId)?.name ?? s.programId },
    { key: 'batch', header: 'Batch', render: (s) => (batchById.get(s.batchId) ? `${batchById.get(s.batchId)!.section}/${batchById.get(s.batchId)!.subsection} (${batchById.get(s.batchId)!.year})` : s.batchId) },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Students</h1>
          <p className="text-sm text-text-muted">Manage student records and enrollment status.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            leadingIcon={<Upload size={16} aria-hidden="true" />}
            onClick={() => setBulkImportOpen(true)}
          >
            Bulk Import
          </Button>
          <Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>
            New Student
          </Button>
        </div>
      </div>

      <Alert color="info">
        <strong>Login credentials</strong> — Username is the student&apos;s email. The initial password is{' '}
        <span className="font-mono text-xs">roll_number_name</span> (full name, lowercase, spaces removed) — e.g.
        roll number <span className="font-mono text-xs">CSE2026001</span> + name &quot;Jane Doe&quot; →{' '}
        <span className="font-mono text-xs">CSE2026001_janedoe</span>. They must set their own password on first
        login.
      </Alert>

      <FilterBar>
        <Search value={search} onChange={(v) => { setSearch(v); pager.reset(); }} debounceMs={300} label="Search students" placeholder="Search by name or roll number…" />
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); pager.reset(); }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ]}
          aria-label="Filter by status"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        getRowKey={(s) => s.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load students"
        emptyTitle="No students found"
        emptyDescription={search || statusFilter ? 'Try clearing your search or filters.' : 'Create the first student to get started.'}
        emptyAction={<Button size="sm" onClick={openCreate}>New Student</Button>}
        renderActions={(s) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => openEdit(s)}>Edit</Button>
            <Button size="sm" variant="tertiary" onClick={() => setDeactivating(s)}>
              {s.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      />

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Student' : 'New Student'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit(onSubmit as never)} loading={createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <FormProvider {...(form as any)}>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit as never)}>
            {rootError && <Alert color="danger">{rootError}</Alert>}
            <FormField name="name" label="Name" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            {!editing && (
              <FormField<StudentFormValues> name="email" label="Email" required>
                {(field) => <Input type="email" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
              </FormField>
            )}
            <FormField name="program_id" label="Program" required>
              {(field) => (
                <Select
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  options={programOptions}
                  placeholder="Select a program"
                />
              )}
            </FormField>
            <FormField name="batch_id" label="Batch" required>
              {(field) => (
                <Select
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  options={batchOptions}
                  placeholder="Select a batch"
                />
              )}
            </FormField>
            <FormField name="roll_number" label="Roll Number" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={deactivating?.status === 'ACTIVE' ? 'Deactivate student?' : 'Reactivate student?'}
        description={
          deactivating?.status === 'ACTIVE'
            ? `"${deactivating?.name}" will be marked inactive and their login access will be revoked.`
            : `"${deactivating?.name}" will be marked active again and their login access restored.`
        }
        confirmLabel={deactivating?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        destructive={deactivating?.status === 'ACTIVE'}
        loading={deactivateMutation.isPending}
        onConfirm={confirmDeactivate}
      />

      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        entityLabel="Student"
        onDownloadTemplate={downloadStudentTemplate}
        onUpload={(file) => bulkImportMutation.mutateAsync(file)}
        onPollJob={fetchImportJob}
      />
    </div>
  );
}
