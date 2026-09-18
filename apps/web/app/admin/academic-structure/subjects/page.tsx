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
import { useSubjects } from '@/lib/queries/useSubjects';
import { useDepartments } from '@/lib/queries/useDepartments';
import { usePrograms } from '@/lib/queries/usePrograms';
import { useCreateSubject, useUpdateSubject } from '@/lib/mutations/useSubjectMutations';
import { mapError } from '@/lib/error-mapping';
import type { Subject } from '@/lib/queries/types';

const subjectSchema = z.object({
  department_id: z.string().uuid('Select a department.'),
  program_id: z.string().uuid().optional().or(z.literal('')),
  code: z.string().min(1, 'Code is required.'),
  name: z.string().min(1, 'Name is required.'),
  credits: z.coerce.number().int().min(0, 'Credits must be 0 or more.').optional().or(z.literal('')),
});
type SubjectFormValues = z.infer<typeof subjectSchema>;

export default function SubjectsPage() {
  const pager = useCursorPager();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'true' | 'false'>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [deactivating, setDeactivating] = useState<Subject | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useSubjects({
    search,
    isActive: statusFilter === '' ? undefined : statusFilter === 'true',
    cursor: pager.cursor,
    limit: 25,
  });
  const { data: departmentsData } = useDepartments({ limit: 200, status: 'ACTIVE' });
  const { data: programsData } = usePrograms({ limit: 200, status: 'ACTIVE' });
  const departmentOptions = (departmentsData?.items ?? []).map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }));
  const programOptions = (programsData?.items ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  const departmentById = new Map((departmentsData?.items ?? []).map((d) => [d.id, d]));

  const createMutation = useCreateSubject();
  const updateMutation = useUpdateSubject(editing?.id ?? '');
  const deactivateMutation = useUpdateSubject(deactivating?.id ?? '');

  const form = useForm<SubjectFormValues>({
    resolver: zodResolver(subjectSchema),
    defaultValues: { department_id: '', program_id: '', code: '', name: '', credits: '' },
  });

  useEffect(() => {
    if (modalOpen) {
      form.reset(
        editing
          ? {
              department_id: editing.departmentId,
              program_id: editing.programId ?? '',
              code: editing.code,
              name: editing.name,
              credits: editing.credits ?? '',
            }
          : { department_id: '', program_id: '', code: '', name: '', credits: '' },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(s: Subject) {
    setEditing(s);
    setModalOpen(true);
  }

  async function onSubmit(values: SubjectFormValues) {
    try {
      const body = {
        department_id: values.department_id,
        program_id: values.program_id || undefined,
        code: values.code,
        name: values.name,
        credits: values.credits === '' || values.credits === undefined ? undefined : Number(values.credits),
      };
      if (editing) {
        await updateMutation.mutateAsync(body);
      } else {
        await createMutation.mutateAsync(body);
      }
      setModalOpen(false);
    } catch (err) {
      const mapped = mapError(err);
      form.setError('root', { message: mapped.description });
    }
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    await deactivateMutation.mutateAsync({ is_active: !deactivating.isActive });
    setDeactivating(null);
  }

  const columns: DataTableColumn<Subject>[] = [
    { key: 'code', header: 'Code', render: (s) => <span className="font-mono text-xs">{s.code}</span> },
    { key: 'name', header: 'Name', render: (s) => s.name },
    { key: 'department', header: 'Department', render: (s) => departmentById.get(s.departmentId)?.name ?? s.departmentId },
    { key: 'credits', header: 'Credits', align: 'right', render: (s) => (s.credits ?? '—').toString() },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Subjects</h1>
          <p className="text-sm text-text-muted">Manage subjects offered under departments and programs.</p>
        </div>
        <Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>
          New Subject
        </Button>
      </div>

      <FilterBar>
        <Search value={search} onChange={(v) => { setSearch(v); pager.reset(); }} debounceMs={300} label="Search subjects" placeholder="Search by name or code…" />
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); pager.reset(); }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
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
        errorTitle="Couldn't load subjects"
        emptyTitle="No subjects found"
        emptyDescription={search || statusFilter ? 'Try clearing your search or filters.' : 'Create the first subject to get started.'}
        emptyAction={<Button size="sm" onClick={openCreate}>New Subject</Button>}
        renderActions={(s) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => openEdit(s)}>Edit</Button>
            <Button size="sm" variant="tertiary" onClick={() => setDeactivating(s)}>
              {s.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      />

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Subject' : 'New Subject'}
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
            <FormField<SubjectFormValues> name="department_id" label="Department" required>
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
            <FormField<SubjectFormValues> name="program_id" label="Program (optional)">
              {(field) => (
                <Select
                  {...field}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  options={[{ value: '', label: '— none —' }, ...programOptions]}
                />
              )}
            </FormField>
            <FormField<SubjectFormValues> name="code" label="Code" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField<SubjectFormValues> name="name" label="Name" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField<SubjectFormValues> name="credits" label="Credits (optional)">
              {(field) => (
                <Input
                  type="number"
                  {...field}
                  value={(field.value as number | '') ?? ''}
                  onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                />
              )}
            </FormField>
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={deactivating?.isActive ? 'Deactivate subject?' : 'Reactivate subject?'}
        description={
          deactivating?.isActive
            ? `"${deactivating?.name}" will be marked inactive. It can be reactivated later.`
            : `"${deactivating?.name}" will be marked active again.`
        }
        confirmLabel={deactivating?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={!!deactivating?.isActive}
        loading={deactivateMutation.isPending}
        onConfirm={confirmDeactivate}
      />
    </div>
  );
}
