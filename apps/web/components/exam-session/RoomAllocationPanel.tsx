'use client';

import { useState } from 'react';
import { Button, Alert, Modal, Select, Checkbox } from '@/components/ui';
import { useAvailableRooms } from '@/lib/queries/useAvailableRooms';
import { useAllocateRooms } from '@/lib/mutations/useRoomAllocationMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, ConflictDetail } from '@/lib/queries/types';

export interface RoomAllocationPanelProps {
  session: ExamSessionDetail;
}

/**
 * Room allocation action for the session detail hub: currently-allocated
 * rooms are already rendered by ExamSessionDetailView's "Rooms" card
 * (from `session.rooms`) — this panel adds the "Allocate Rooms" action
 * that opens manual (pick specific rooms, filtered via `useAvailableRooms`
 * for the session's own date/time) or auto (Best-Fit-Decreasing across all
 * or a narrowed candidate set) allocation, calling
 * `POST /exam-sessions/{id}/rooms/allocate`. Only meaningful while
 * ASSIGNING_STUDENTS (room-allocation.service.ts's own precondition) —
 * the button is hidden otherwise since the call would just 409.
 */
export function RoomAllocationPanel({ session }: RoomAllocationPanelProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'manual' | 'auto'>('auto');
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const allocateMutation = useAllocateRooms(session.id);

  const availableRoomsQuery = useAvailableRooms({
    date: session.sessionDate.slice(0, 10),
    startTime: session.startTime.slice(11, 16) || session.startTime.slice(0, 5),
    endTime: session.endTime.slice(11, 16) || session.endTime.slice(0, 5),
  });

  const canAllocate = session.status === 'ASSIGNING_STUDENTS';

  function toggleRoom(id: string) {
    setSelectedRoomIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  async function onAllocate() {
    try {
      if (mode === 'manual') {
        await allocateMutation.mutateAsync({ room_ids: selectedRoomIds });
      } else {
        await allocateMutation.mutateAsync({ auto: true });
      }
      setOpen(false);
      setSelectedRoomIds([]);
    } catch {
      // surfaced below via allocateMutation.error, keep the modal open
    }
  }

  const conflictDetails = (allocateMutation.error ? (mapError(allocateMutation.error).details as ConflictDetail[] | undefined) : undefined) ?? [];

  if (!canAllocate) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>Allocate Rooms</Button>
      </div>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) allocateMutation.reset();
        }}
        title="Allocate Rooms"
        description="Assign one or more rooms to this session's ASSIGNED students, either by hand or automatically (Best-Fit Decreasing packing)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={allocateMutation.isPending}>Cancel</Button>
            <Button
              onClick={onAllocate}
              loading={allocateMutation.isPending}
              disabled={mode === 'manual' && selectedRoomIds.length === 0}
            >
              Allocate
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {allocateMutation.isError && (
            <Alert color="danger" title="Couldn't allocate rooms">
              <div className="flex flex-col gap-1">
                <span>{mapError(allocateMutation.error).description}</span>
                {conflictDetails.length > 0 && (
                  <ul className="list-disc pl-4 text-xs">
                    {conflictDetails.map((d, i) => (
                      <li key={i}>{d.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Alert>
          )}

          <Select
            label="Mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'manual' | 'auto')}
            options={[
              { value: 'auto', label: 'Automatic (best-fit across available rooms)' },
              { value: 'manual', label: 'Manual (pick specific rooms)' },
            ]}
          />

          {mode === 'manual' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-text-muted">
                Rooms available for {session.sessionDate.slice(0, 10)} in this session&apos;s time window:
              </p>
              {availableRoomsQuery.isLoading ? (
                <p className="text-sm text-text-muted">Loading available rooms…</p>
              ) : (availableRoomsQuery.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-text-muted">No available rooms found for this window.</p>
              ) : (
                <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                  {availableRoomsQuery.data!.map((room) => (
                    <li key={room.id}>
                      <Checkbox
                        label={`${room.building} · Room ${room.roomNumber} (capacity ${room.capacity})`}
                        checked={selectedRoomIds.includes(room.id)}
                        onChange={() => toggleRoom(room.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
