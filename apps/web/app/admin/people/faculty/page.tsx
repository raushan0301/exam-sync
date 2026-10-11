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
import { useFaculty } from '@/lib/queries/useFaculty';
import { useDepartments } from '@/lib/queries/useDepartments';
import {
  useCreateFaculty,
  useUpdateFaculty,
  useBulkImportFaculty,
  downloadFacultyTemplate,
} from '@/lib/mutations/useFacultyMutations';
import { fetchImportJob } from '@/lib/mutations/useStudentMutations';
import { mapError } from '@/lib/error-mapping';
import type { Faculty } from '@/lib/queries/types';

const facultySchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  email: z.string().email('Enter a valid email address.'),
  department_id: z.string().uuid('Select a department.'),
  employee_code: z.string().min(1, 'Employee code is required.'),
});
type FacultyFormValues = z.infer<typeof facultySchema>;

const editFacultySchema = facultySchema.omit({ email: true });
type EditFacultyFormValues = z.infer<typeof editFacultySchema>;

export default function FacultyPage() {
  const pager = useCursorPager();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Faculty | null>(null);
  const [deactivating, setDeactivating] = useState<Faculty | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useFaculty({
    search,
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const { data: departmentsData } = useDepartments({ all: true, status: 'ACTIVE' });
  const departmentOptions = (departmentsData?.items ?? []).map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }));
  const departmentById = new Map((departmentsData?.items ?? []).map((d) => [d.id, d]));

  const createMutation = useCreateFaculty();
  const updateMutation = useUpdateFaculty(editing?.id ?? '');
  const deactivateMutation = useUpdateFaculty(deactivating?.id ?? '');
  const bulkImportMutation = useBulkImportFaculty();

  const createForm = useForm<FacultyFormValues>({
    resolver: zodResolver(facultySchema),
    defaultValues: { name: '', email: '', department_id: '', employee_code: '' },
  });
  const editForm = useForm<EditFacultyFormValues>({
    resolver: zodResolver(editFacultySchema),
    defaultValues: { name: '', department_id: '', employee_code: '' },
  });
  const form = editing ? editForm : createForm;

  useEffect(() => {
    if (modalOpen && editing) {
      editForm.reset({ name: editing.name, department_id: editing.departmentId, employee_code: editing.employeeCode });
    } else if (modalOpen && !editing) {
      createForm.reset({ name: '', email: '', department_id: '', employee_code: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(f: Faculty) {
    setEditing(f);
    setModalOpen(true);
  }

  async function onSubmit(values: FacultyFormValues | EditFacultyFormValues) {
    try {
      if (editing) {
        await updateMutation.mutateAsync(values as EditFacultyFormValues);
      } else {
        await createMutation.mutateAsync(values as FacultyFormValues);
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

  const columns: DataTableColumn<Faculty>[] = [
    { key: 'employeeCode', header: 'Employee Code', render: (f) => <span className="font-mono text-xs">{f.employeeCode}</span> },
    { key: 'name', header: 'Name', render: (f) => f.name },
    { key: 'department', header: 'Department', render: (f) => departmentById.get(f.departmentId)?.name ?? f.departmentId },
    { key: 'status', header: 'Status', render: (f) => <StatusBadge status={f.status} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Faculty</h1>
          <p className="text-sm text-text-muted">Manage faculty records and department assignment.</p>
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
            New Faculty
          </Button>
        </div>
      </div>

      <Alert color="info">
        <strong>Login credentials</strong> — Username is the faculty member&apos;s email. The initial password is{' '}
        <span className="font-mono text-xs">employee_code_name</span> (full name, lowercase, spaces removed) — e.g.
        employee code <span className="font-mono text-xs">FAC001</span> + name &quot;John Smith&quot; →{' '}
        <span className="font-mono text-xs">FAC001_johnsmith</span>. They must set their own password on first
        login.
      </Alert>

      <FilterBar>
        <Search value={search} onChange={(v) => { setSearch(v); pager.reset(); }} debounceMs={300} label="Search faculty" placeholder="Search by name or employee code…" />
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
        getRowKey={(f) => f.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load faculty"
        emptyTitle="No faculty found"
        emptyDescription={search || statusFilter ? 'Try clearing your search or filters.' : 'Create the first faculty record to get started.'}
        emptyAction={<Button size="sm" onClick={openCreate}>New Faculty</Button>}
        renderActions={(f) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => openEdit(f)}>Edit</Button>
            <Button size="sm" variant="tertiary" onClick={() => setDeactivating(f)}>
              {f.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      />

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Faculty' : 'New Faculty'}
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
              <FormField<FacultyFormValues> name="email" label="Email" required>
                {(field) => <Input type="email" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
              </FormField>
            )}
            <FormField name="department_id" label="Department" required>
              {(field) => (
                <Select
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  options={departmentOptions}
                  placeholder="Select a department"
                />
              )}
            </FormField>
            <FormField name="employee_code" label="Employee Code" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={deactivating?.status === 'ACTIVE' ? 'Deactivate faculty?' : 'Reactivate faculty?'}
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
        entityLabel="Faculty"
        onDownloadTemplate={downloadFacultyTemplate}
        onUpload={(file) => bulkImportMutation.mutateAsync(file)}
        onPollJob={fetchImportJob}
      />
    </div>
  );
}
