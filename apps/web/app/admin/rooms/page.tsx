'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { useRooms } from '@/lib/queries/useRooms';
import { useCreateRoom, useUpdateRoom } from '@/lib/mutations/useRoomMutations';
import { mapError } from '@/lib/error-mapping';
import type { Room, RoomStatus } from '@/lib/queries/types';

const createRoomSchema = z.object({
  building: z.string().min(1, 'Building is required.'),
  floor: z.coerce.number().int('Floor must be a whole number.'),
  room_number: z.string().min(1, 'Room number is required.'),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1.'),
  rows: z.coerce.number().int().min(1, 'Rows must be at least 1.'),
  columns: z.coerce.number().int().min(1, 'Columns must be at least 1.'),
});
type CreateRoomFormValues = z.infer<typeof createRoomSchema>;

const editRoomSchema = z.object({
  building: z.string().min(1, 'Building is required.'),
  floor: z.coerce.number().int('Floor must be a whole number.'),
  room_number: z.string().min(1, 'Room number is required.'),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1.'),
});
type EditRoomFormValues = z.infer<typeof editRoomSchema>;

/**
 * Rooms management — same DataTable/create-edit-modal/ConfirmationDialog
 * shape as Students/Faculty (M4). `rows`/`columns` are creation-only (the
 * backend generates the seat map once at POST time and PATCH doesn't
 * accept them — verified against rooms/dto/update-room.dto.ts), so the
 * edit form omits them. Room detail (seat grid + availability blocks)
 * lives at `/admin/rooms/[id]`, following the same "row -> detail
 * sub-page" pattern M6 established for exam sessions.
 */
export default function RoomsPage() {
  const router = useRouter();
  const pager = useCursorPager();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | RoomStatus>('');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [deactivating, setDeactivating] = useState<Room | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useRooms({
    search,
    status: statusFilter || undefined,
    building: buildingFilter || undefined,
    cursor: pager.cursor,
    limit: 25,
  });

  const createMutation = useCreateRoom();
  const updateMutation = useUpdateRoom(editing?.id ?? '');
  const deactivateMutation = useUpdateRoom(deactivating?.id ?? '');

  const createForm = useForm<CreateRoomFormValues>({
    resolver: zodResolver(createRoomSchema),
    defaultValues: { building: '', floor: 0, room_number: '', capacity: 1, rows: 1, columns: 1 },
  });
  const editForm = useForm<EditRoomFormValues>({
    resolver: zodResolver(editRoomSchema),
    defaultValues: { building: '', floor: 0, room_number: '', capacity: 1 },
  });
  const form = editing ? editForm : createForm;

  useEffect(() => {
    if (modalOpen && editing) {
      editForm.reset({
        building: editing.building,
        floor: editing.floor,
        room_number: editing.roomNumber,
        capacity: editing.capacity,
      });
    } else if (modalOpen && !editing) {
      createForm.reset({ building: '', floor: 0, room_number: '', capacity: 1, rows: 1, columns: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editing]);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(r: Room) {
    setEditing(r);
    setModalOpen(true);
  }

  async function onSubmit(values: CreateRoomFormValues | EditRoomFormValues) {
    try {
      if (editing) {
        await updateMutation.mutateAsync(values as EditRoomFormValues);
      } else {
        await createMutation.mutateAsync(values as CreateRoomFormValues);
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

  const columns: DataTableColumn<Room>[] = [
    { key: 'roomNumber', header: 'Room', render: (r) => <span className="font-mono text-xs">{r.roomNumber}</span> },
    { key: 'building', header: 'Building', render: (r) => r.building },
    { key: 'floor', header: 'Floor', render: (r) => r.floor },
    { key: 'capacity', header: 'Capacity', render: (r) => `${r.capacity} (${r.rows}×${r.columns})` },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Rooms</h1>
          <p className="text-sm text-text-muted">Manage exam rooms, seat layouts, and availability blocks.</p>
        </div>
        <Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>
          New Room
        </Button>
      </div>

      <FilterBar>
        <Search value={search} onChange={(v) => { setSearch(v); pager.reset(); }} debounceMs={300} label="Search rooms" placeholder="Search by room number…" />
        <Input
          value={buildingFilter}
          onChange={(e) => { setBuildingFilter(e.target.value); pager.reset(); }}
          placeholder="Filter by building…"
          aria-label="Filter by building"
        />
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); pager.reset(); }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'MAINTENANCE', label: 'Maintenance' },
            { value: 'INACTIVE', label: 'Inactive' },
          ]}
          aria-label="Filter by status"
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        getRowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        retrying={isFetching}
        errorTitle="Couldn't load rooms"
        emptyTitle="No rooms yet"
        emptyDescription={search || statusFilter || buildingFilter ? 'Try clearing your search or filters.' : 'Create the first room to get started.'}
        emptyAction={<Button size="sm" onClick={openCreate}>New Room</Button>}
        renderActions={(r) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => router.push(`/admin/rooms/${r.id}`)}>View</Button>
            <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button>
            <Button size="sm" variant="tertiary" onClick={() => setDeactivating(r)}>
              {r.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      />

      {(data?.items?.length ?? 0) > 0 && (
        <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
      )}

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? 'Edit Room' : 'New Room'}
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
            <FormField name="building" label="Building" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField name="floor" label="Floor" required>
              {(field) => <Input type="number" {...field} value={(field.value as number) ?? 0} onChange={(e) => field.onChange(e.target.valueAsNumber)} />}
            </FormField>
            <FormField name="room_number" label="Room Number" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField name="capacity" label="Capacity" required>
              {(field) => <Input type="number" min={1} {...field} value={(field.value as number) ?? 1} onChange={(e) => field.onChange(e.target.valueAsNumber)} />}
            </FormField>
            {!editing && (
              <>
                <FormField<CreateRoomFormValues> name="rows" label="Rows" description="Used once, at creation, to generate the seat map." required>
                  {(field) => <Input type="number" min={1} {...field} value={(field.value as number) ?? 1} onChange={(e) => field.onChange(e.target.valueAsNumber)} />}
                </FormField>
                <FormField<CreateRoomFormValues> name="columns" label="Columns" required>
                  {(field) => <Input type="number" min={1} {...field} value={(field.value as number) ?? 1} onChange={(e) => field.onChange(e.target.valueAsNumber)} />}
                </FormField>
              </>
            )}
          </form>
        </FormProvider>
      </Modal>

      <ConfirmationDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={deactivating?.status === 'ACTIVE' ? 'Deactivate room?' : 'Reactivate room?'}
        description={
          deactivating?.status === 'ACTIVE'
            ? `"${deactivating?.roomNumber}" will be marked inactive and excluded from room allocation.`
            : `"${deactivating?.roomNumber}" will be marked active again and eligible for room allocation.`
        }
        confirmLabel={deactivating?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        destructive={deactivating?.status === 'ACTIVE'}
        loading={deactivateMutation.isPending}
        onConfirm={confirmDeactivate}
      />
    </div>
  );
}
