'use client';

import { useEffect, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Upload } from 'lucide-react';
import {
  Button,
  Input,
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
import { useBatches } from '@/lib/queries/useBatches';
import { usePrograms } from '@/lib/queries/usePrograms';
import {
  useCreateBatch,
  useUpdateBatch,
  useBulkImportBatches,
  downloadBatchTemplate,
} from '@/lib/mutations/useBatchMutations';
import { fetchImportJob } from '@/lib/mutations/useStudentMutations';
import { mapError } from '@/lib/error-mapping';
import type { Batch } from '@/lib/queries/types';

const batchSchema = z.object({
  program_id: z.string().uuid('Select a program.'),
  year: z.string().min(1, 'Year is required.'),
  section: z.string().min(1, 'Section is required.'),
  subsection: z.string().min(1, 'Subsection is required.'),
});
type BatchFormValues = z.infer<typeof batchSchema>;

// batches.controller.ts does not accept a `search` query param — no Search
// input here (unlike departments/programs/students/faculty).
export default function BatchesPage() {
  const pager = useCursorPager();
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Batch | null>(null);
  const [deactivating, setDeactivating] = useState<Batch | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useBatches({
    status: statusFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });
  const { data: programsData } = usePrograms({ all: true, status: 'ACTIVE' });
  const programOptions = (programsData?.items ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  const programById = new Map((programsData?.items ?? []).map((p) => [p.id, p]));

  const createMutation = useCreateBatch();
  const updateMutation = useUpdateBatch(editing?.id ?? '');
  const deactivateMutation = useUpdateBatch(deactivating?.id ?? '');
  const bulkImportMutation = useBulkImportBatches();

  const form = useForm<BatchFormValues>({
    resolver: zodResolver(batchSchema),
    defaultValues: { program_id: '', year: '', section: '', subsection: '' },
  });

  useEffect(() => {
    if (modalOpen) {
      form.reset(
        editing
          ? {
              program_id: editing.programId,
              year: editing.year,
              section: editing.section,
              subsection: editing.subsection,
            }
          : { program_id: '', year: '', section: '', subsection: '' },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(b: Batch) {
    setEditing(b);
    setModalOpen(true);
  }

  async function onSubmit(values: BatchFormValues) {
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

  const columns: DataTableColumn<Batch>[] = [
    { key: 'program', header: 'Program', render: (b) => programById.get(b.programId)?.name ?? b.programId },
    { key: 'year', header: 'Year', render: (b) => b.year },
    { key: 'section', header: 'Section', render: (b) => b.section },
    { key: 'subsection', header: 'Subsection', render: (b) => b.subsection },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Batches</h1>
          <p className="text-sm text-text-muted">Manage student batches (year/section) within programs.</p>
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
            New Batch
          </Button>
        </div>
      </div>

      <FilterBar>
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
        getRowKey={(b) => b.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load batches"
        emptyTitle="No batches found"
        emptyDescription={statusFilter ? 'Try clearing your filters.' : 'Create the first batch to get started.'}
        emptyAction={<Button size="sm" onClick={openCreate}>New Batch</Button>}
        renderActions={(b) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => openEdit(b)}>Edit</Button>
            <Button size="sm" variant="tertiary" onClick={() => setDeactivating(b)}>
              {b.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      />

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Batch' : 'New Batch'}
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
            <FormField<BatchFormValues> name="program_id" label="Program" required>
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
            <FormField<BatchFormValues> name="year" label="Year" required>
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. 4 or 2023-2027"
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            </FormField>
            <FormField<BatchFormValues> name="section" label="Section" required>
              {(field) => <Input {...field} placeholder="e.g. 4C2" value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField<BatchFormValues> name="subsection" label="Subsection" required>
              {(field) => <Input {...field} placeholder="e.g. 4C24" value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={deactivating?.status === 'ACTIVE' ? 'Deactivate batch?' : 'Reactivate batch?'}
        description={
          deactivating?.status === 'ACTIVE'
            ? `Batch "${deactivating?.section}/${deactivating?.subsection} (${deactivating?.year})" will be marked inactive.`
            : `Batch "${deactivating?.section}/${deactivating?.subsection} (${deactivating?.year})" will be marked active again.`
        }
        confirmLabel={deactivating?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        destructive={deactivating?.status === 'ACTIVE'}
        loading={deactivateMutation.isPending}
        onConfirm={confirmDeactivate}
      />

      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        entityLabel="Batch"
        onDownloadTemplate={downloadBatchTemplate}
        onUpload={(file) => bulkImportMutation.mutateAsync(file)}
        onPollJob={fetchImportJob}
      />
    </div>
  );
}
