'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Card,
  StatusBadge,
  Button,
  Alert,
  SkeletonText,
  ErrorState,
  Modal,
  FormField,
  Input,
  TimeInput,
  EmptyState,
} from '@/components/ui';
import { useRoom } from '@/lib/queries/useRooms';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { useRoomAvailabilityBlocks } from '@/lib/queries/useRoomAvailabilityBlocks';
import { useUpdateRoomSeat, useCreateAvailabilityBlock } from '@/lib/mutations/useRoomMutations';
import { mapError } from '@/lib/error-mapping';
import { formatTimeRange } from '@/lib/format-time';
import type { RoomSeat } from '@/lib/queries/types';

const blockSchema = z.object({
  date: z.string().min(1, 'Date is required.'),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM.'),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM.'),
  reason: z.string().min(1, 'Reason is required.'),
});
type BlockFormValues = z.infer<typeof blockSchema>;

/**
 * Room detail: a SIMPLE rows×columns seat grid (basic layout confirmation
 * only — no anti-cheating visualization, no subject coloring; a full
 * physical seat-map renderer is out of scope for M7) with a per-seat
 * inline active/accessible toggle, plus an availability-blocks list +
 * create form. Follows the same "detail sub-page" pattern M6 used for
 * `/admin/exam-sessions/[id]`.
 */
export default function RoomDetailPage() {
  const params = useParams<{ id: string }>();
  // Next.js can reuse this same component instance across navigations
  // between two different room ids (client-side route change, no full
  // remount) — without a key tied to the id, `selectedSeat`/
  // `blockModalOpen`/the availability-block form's local state would
  // leak from the previous room into the next one. Same fix already
  // applied to ExamSessionDetailView/QuizDetailView's own page.tsx
  // wrappers; this page has no existing wrapper to key, so one is added
  // here just for that purpose.
  return <RoomDetailInner key={params.id} roomId={params.id} />;
}

function RoomDetailInner({ roomId }: { roomId: string }) {
  const roomQuery = useRoom(roomId);
  const seatsQuery = useRoomSeats(roomId);
  const blocksQuery = useRoomAvailabilityBlocks(roomId, { all: true });
  const updateSeatMutation = useUpdateRoomSeat(roomId);
  const createBlockMutation = useCreateAvailabilityBlock(roomId);

  const [selectedSeat, setSelectedSeat] = useState<RoomSeat | null>(null);
  const [blockModalOpen, setBlockModalOpen] = useState(false);

  const blockForm = useForm<BlockFormValues>({
    resolver: zodResolver(blockSchema),
    defaultValues: { date: '', start_time: '', end_time: '', reason: '' },
  });

  async function onCreateBlock(values: BlockFormValues) {
    try {
      await createBlockMutation.mutateAsync(values);
      setBlockModalOpen(false);
      blockForm.reset({ date: '', start_time: '', end_time: '', reason: '' });
    } catch (err) {
      const mapped = mapError(err);
      blockForm.setError('root', { message: mapped.description });
    }
  }

  async function toggleSeatField(seat: RoomSeat, field: 'is_active' | 'is_accessible') {
    try {
      await updateSeatMutation.mutateAsync({
        seatId: seat.id,
        [field]: field === 'is_active' ? !seat.isActive : !seat.isAccessible,
      } as never);
    } catch {
      // surfaced below via updateSeatMutation.isError/.error, modal stays open
      return;
    }
    setSelectedSeat(null);
  }

  if (roomQuery.isLoading) {
    return (
      <Card>
        <SkeletonText lines={6} />
      </Card>
    );
  }

  if (roomQuery.isError) {
    const mapped = mapError(roomQuery.error);
    return <ErrorState title={mapped.title} description={mapped.description} onRetry={() => roomQuery.refetch()} />;
  }

  const room = roomQuery.data;
  if (!room) return null;

  const seatsByRow = new Map<number, RoomSeat[]>();
  for (const seat of seatsQuery.data ?? []) {
    const row = seatsByRow.get(seat.rowIndex) ?? [];
    row.push(seat);
    seatsByRow.set(seat.rowIndex, row);
  }
  const rowIndices = [...seatsByRow.keys()].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      <Card
        header={
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-text">
              {room.building} · Floor {room.floor} · Room {room.roomNumber}
            </h1>
            <StatusBadge status={room.status} />
          </div>
        }
      >
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-text-muted">Capacity</dt>
            <dd className="text-text">{room.capacity}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Layout</dt>
            <dd className="text-text">{room.rows} rows × {room.columns} columns</dd>
          </div>
          <div>
            <dt className="text-text-muted">Accessibility Info</dt>
            <dd className="text-text">{room.accessibilityInfo ? JSON.stringify(room.accessibilityInfo) : '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Seat Layout</h2>} padding="dense">
        {seatsQuery.isLoading ? (
          <SkeletonText lines={4} />
        ) : (seatsQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-text-muted">No seats found for this room.</p>
        ) : (
          <div className="flex flex-col gap-1 overflow-x-auto">
            {rowIndices.map((rowIdx) => (
              <div key={rowIdx} className="flex gap-1">
                {(seatsByRow.get(rowIdx) ?? [])
                  .sort((a, b) => a.colIndex - b.colIndex)
                  .map((seat) => (
                    <button
                      key={seat.id}
                      type="button"
                      onClick={() => setSelectedSeat(seat)}
                      title={seat.seatLabel}
                      className={[
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded border text-[10px] font-mono',
                        seat.isActive ? 'border-border bg-surface text-text' : 'border-border bg-surface-muted text-text-muted line-through',
                        seat.isAccessible ? 'ring-2 ring-info' : '',
                      ].join(' ')}
                    >
                      {seat.seatLabel}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-text-muted">Click a seat to toggle active / accessible. Ringed seats are marked accessible.</p>
      </Card>

      <Card
        header={
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Availability Blocks</h2>
            <Button size="sm" onClick={() => setBlockModalOpen(true)}>Add Block</Button>
          </div>
        }
        padding="dense"
      >
        {blocksQuery.isLoading ? (
          <SkeletonText lines={3} />
        ) : blocksQuery.isError ? (
          <ErrorState title="Couldn't load availability blocks" onRetry={() => blocksQuery.refetch()} />
        ) : (blocksQuery.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No availability blocks" description="This room has no scheduled blackout windows." />
        ) : (
          <ul className="flex flex-col gap-2">
            {blocksQuery.data!.items.map((block) => (
              <li key={block.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
                <span className="text-text">
                  {block.date.slice(0, 10)} · {formatTimeRange(block.startTime, block.endTime)}
                </span>
                <span className="text-text-muted">{block.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!selectedSeat}
        onOpenChange={(open) => !open && setSelectedSeat(null)}
        title={selectedSeat ? `Seat ${selectedSeat.seatLabel}` : 'Seat'}
        footer={<Button variant="secondary" onClick={() => setSelectedSeat(null)}>Close</Button>}
      >
        {selectedSeat && (
          <div className="flex flex-col gap-3">
            {updateSeatMutation.isError && (
              <Alert color="danger" title="Couldn't update seat">{mapError(updateSeatMutation.error).description}</Alert>
            )}
            <Button
              variant="secondary"
              loading={updateSeatMutation.isPending}
              onClick={() => toggleSeatField(selectedSeat, 'is_active')}
            >
              {selectedSeat.isActive ? 'Disable seat' : 'Enable seat'}
            </Button>
            <Button
              variant="secondary"
              loading={updateSeatMutation.isPending}
              onClick={() => toggleSeatField(selectedSeat, 'is_accessible')}
            >
              {selectedSeat.isAccessible ? 'Unmark accessible' : 'Mark accessible'}
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        open={blockModalOpen}
        onOpenChange={setBlockModalOpen}
        title="Add Availability Block"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBlockModalOpen(false)}>Cancel</Button>
            <Button onClick={blockForm.handleSubmit(onCreateBlock)} loading={createBlockMutation.isPending}>Add Block</Button>
          </>
        }
      >
        <FormProvider {...blockForm}>
          <form className="flex flex-col gap-4" onSubmit={blockForm.handleSubmit(onCreateBlock)}>
            {blockForm.formState.errors.root?.message && <Alert color="danger">{blockForm.formState.errors.root.message}</Alert>}
            <FormField<BlockFormValues> name="date" label="Date" required>
              {(field) => <Input type="date" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
            <FormField<BlockFormValues> name="start_time" label="Start Time" required>
              {(field) => <TimeInput id={field.id} ariaLabel="Start Time" value={(field.value as string) ?? ''} onChange={(v) => field.onChange(v)} />}
            </FormField>
            <FormField<BlockFormValues> name="end_time" label="End Time" required>
              {(field) => <TimeInput id={field.id} ariaLabel="End Time" value={(field.value as string) ?? ''} onChange={(v) => field.onChange(v)} />}
            </FormField>
            <FormField<BlockFormValues> name="reason" label="Reason" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>
          </form>
        </FormProvider>
      </Modal>
    </div>
  );
}
