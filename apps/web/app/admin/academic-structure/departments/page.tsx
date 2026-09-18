'use client';

import { useEffect, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
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
import { useDepartments } from '@/lib/queries/useDepartments';
import { useCreateDepartment, useUpdateDepartment } from '@/lib/mutations/useDepartmentMutations';
import { mapError } from '@/lib/error-mapping';
import type { Department } from '@/lib/queries/types';

const departmentSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  code: z.string().min(1, 'Code is required.'),
});
type DepartmentFormValues = z.infer<typeof departmentSchema>;

export default function DepartmentsPage() {
  const pager = useCursorPager();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deactivating, setDeactivating] = useState<Department | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useDepartments({
    search,
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });

  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment(editing?.id ?? '');
  const deactivateMutation = useUpdateDepartment(deactivating?.id ?? '');

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: '', code: '' },
  });

  useEffect(() => {
    if (modalOpen) {
      form.reset(editing ? { name: editing.name, code: editing.code } : { name: '', code: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(dept: Department) {
    setEditing(dept);
    setModalOpen(true);
  }

  async function onSubmit(values: DepartmentFormValues) {
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
    await deactivateMutation.mutateAsync({
      status: deactivating.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    });
    setDeactivating(null);
  }

  const columns: DataTableColumn<Department>[] = [
    { key: 'code', header: 'Code', render: (d) => <span className="font-mono text-xs">{d.code}</span> },
    { key: 'name', header: 'Name', render: (d) => d.name },
    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Departments</h1>
          <p className="text-sm text-text-muted">Manage academic departments.</p>
        </div>
        <Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>
          New Department
        </Button>
      </div>

      <FilterBar>
        <Search value={search} onChange={(v) => { setSearch(v); pager.reset(); }} debounceMs={300} label="Search departments" placeholder="Search by name or code…" />
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
        getRowKey={(d) => d.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load departments"
        emptyTitle="No departments found"
        emptyDescription={search || statusFilter ? 'Try clearing your search or filters.' : 'Create the first department to get started.'}
        emptyAction={<Button size="sm" onClick={openCreate}>New Department</Button>}
        renderActions={(d) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => openEdit(d)}>Edit</Button>
            <Button size="sm" variant="tertiary" onClick={() => setDeactivating(d)}>
              {d.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      />

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Department' : 'New Department'}
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
            <FormField<DepartmentFormValues> name="name" label="Name" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField<DepartmentFormValues> name="code" label="Code" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={deactivating?.status === 'ACTIVE' ? 'Deactivate department?' : 'Reactivate department?'}
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
    </div>
  );
}
