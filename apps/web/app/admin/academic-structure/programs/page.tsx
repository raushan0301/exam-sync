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
import { usePrograms } from '@/lib/queries/usePrograms';
import { useDepartments } from '@/lib/queries/useDepartments';
import {
  useCreateProgram,
  useUpdateProgram,
  useBulkImportPrograms,
  downloadProgramTemplate,
} from '@/lib/mutations/useProgramMutations';
import { fetchImportJob } from '@/lib/mutations/useStudentMutations';
import { mapError } from '@/lib/error-mapping';
import type { Program } from '@/lib/queries/types';

const programSchema = z.object({
  department_id: z.string().uuid('Select a department.'),
  name: z.string().min(1, 'Name is required.'),
  code: z.string().min(1, 'Code is required.'),
});
type ProgramFormValues = z.infer<typeof programSchema>;

export default function ProgramsPage() {
  const pager = useCursorPager();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const [deactivating, setDeactivating] = useState<Program | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = usePrograms({
    search,
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const { data: departmentsData } = useDepartments({ all: true, status: 'ACTIVE' });
  const departmentOptions = (departmentsData?.items ?? []).map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }));
  const departmentById = new Map((departmentsData?.items ?? []).map((d) => [d.id, d]));

  const createMutation = useCreateProgram();
  const updateMutation = useUpdateProgram(editing?.id ?? '');
  const deactivateMutation = useUpdateProgram(deactivating?.id ?? '');
  const bulkImportMutation = useBulkImportPrograms();

  const form = useForm<ProgramFormValues>({
    resolver: zodResolver(programSchema),
    defaultValues: { department_id: '', name: '', code: '' },
  });

  useEffect(() => {
    if (modalOpen) {
      form.reset(
        editing
          ? { department_id: editing.departmentId, name: editing.name, code: editing.code }
          : { department_id: '', name: '', code: '' },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(p: Program) {
    setEditing(p);
    setModalOpen(true);
  }

  async function onSubmit(values: ProgramFormValues) {
    try {
      if (editing) {
        await updateMutation.mutateAsync(values);
      } else {
        await createMutation.mutateAsync(values);
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

  const columns: DataTableColumn<Program>[] = [
    { key: 'code', header: 'Code', render: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { key: 'name', header: 'Name', render: (p) => p.name },
    { key: 'department', header: 'Department', render: (p) => departmentById.get(p.departmentId)?.name ?? p.departmentId },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Programs</h1>
          <p className="text-sm text-text-muted">Manage academic programs within departments.</p>
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
            New Program
          </Button>
        </div>
      </div>

      <FilterBar>
        <Search value={search} onChange={(v) => { setSearch(v); pager.reset(); }} debounceMs={300} label="Search programs" placeholder="Search by name or code…" />
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
        getRowKey={(p) => p.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load programs"
        emptyTitle="No programs found"
        emptyDescription={search || statusFilter ? 'Try clearing your search or filters.' : 'Create the first program to get started.'}
        emptyAction={<Button size="sm" onClick={openCreate}>New Program</Button>}
        renderActions={(p) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Button>
            <Button size="sm" variant="tertiary" onClick={() => setDeactivating(p)}>
              {p.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      />

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Program' : 'New Program'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit(onSubmit)} loading={createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <FormProvider {...form}>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            {rootError && <Alert color="danger">{rootError}</Alert>}
            <FormField<ProgramFormValues> name="department_id" label="Department" required>
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
            <FormField<ProgramFormValues> name="name" label="Name" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField<ProgramFormValues> name="code" label="Code" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={deactivating?.status === 'ACTIVE' ? 'Deactivate program?' : 'Reactivate program?'}
        description={
          deactivating?.status === 'ACTIVE'
            ? `"${deactivating?.name}" will be marked inactive. It can be reactivated later.`
            : `"${deactivating?.name}" will be marked active again.`
        }
        confirmLabel={deactivating?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        destructive={deactivating?.status === 'ACTIVE'}
        loading={deactivateMutation.isPending}
        onConfirm={confirmDeactivate}
      />

      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        entityLabel="Program"
        onDownloadTemplate={downloadProgramTemplate}
        onUpload={(file) => bulkImportMutation.mutateAsync(file)}
        onPollJob={fetchImportJob}
      />
    </div>
  );
}
