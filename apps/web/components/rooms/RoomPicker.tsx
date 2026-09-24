'use client';

import { Checkbox, SearchableSelect } from '@/components/ui';
import type { AvailableRoomOption } from '@/lib/queries/types';

export interface RoomPickerProps {
  /** Every room available for this date/time window — the full pool, not just what a strategy happened to pick. */
  allRooms: AvailableRoomOption[];
  totalStudents: number;
  roomIds: string[];
  onChangeRoomIds: (ids: string[]) => void;
  backupRoomId: string;
  onChangeBackupRoomId: (id: string) => void;
}

function roomLabel(r: AvailableRoomOption) {
  return `${r.building} · Room ${r.roomNumber} (capacity ${r.capacity})`;
}

/**
 * Manual room picker shared by the quiz-stage and exam-session-stage
 * room-request panels: a live seats-selected/needed counter, a checklist
 * of the rooms a strategy suggested, a "+ Add another room" dropdown
 * offering EVERY available room (not just the suggested subset) so the
 * faculty can build any combination by hand, and a backup-room dropdown
 * offering any room not already selected as a primary.
 */
export function RoomPicker({ allRooms, totalStudents, roomIds, onChangeRoomIds, backupRoomId, onChangeBackupRoomId }: RoomPickerProps) {
  // A 0-capacity "room" (no active seats) can't hold anyone — exclude it from every picker so it never shows up as a dead-end choice.
  const usableRooms = allRooms.filter((r) => r.capacity > 0);
  const roomsById = new Map(usableRooms.map((r) => [r.roomId, r]));
  const selectedRooms = roomIds.map((id) => roomsById.get(id)).filter((r): r is AvailableRoomOption => !!r);
  const selectedCapacity = selectedRooms.reduce((sum, r) => sum + r.capacity, 0);
  const seated = Math.min(selectedCapacity, totalStudents);
  const remaining = Math.max(0, totalStudents - selectedCapacity);
  const spare = Math.max(0, selectedCapacity - totalStudents);

  const unselectedRooms = usableRooms.filter((r) => !roomIds.includes(r.roomId) && r.roomId !== backupRoomId);
  const backupOptions = usableRooms.filter((r) => !roomIds.includes(r.roomId));

  function toggleRoom(roomId: string) {
    onChangeRoomIds(roomIds.includes(roomId) ? roomIds.filter((id) => id !== roomId) : [...roomIds, roomId]);
  }

  function addRoom(roomId: string) {
    if (!roomId || roomIds.includes(roomId)) return;
    onChangeRoomIds([...roomIds, roomId]);
    if (backupRoomId === roomId) onChangeBackupRoomId('');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded border border-border bg-surface-muted p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-text">
            {seated} of {totalStudents} students seated
          </span>
          <span className="text-text-muted">{selectedCapacity} seat{selectedCapacity === 1 ? '' : 's'} selected across {roomIds.length} room{roomIds.length === 1 ? '' : 's'}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
          <div
            className={`h-full rounded-full ${remaining === 0 ? 'bg-success-600' : 'bg-primary-600'}`}
            style={{ width: `${totalStudents === 0 ? 0 : Math.min(100, (seated / totalStudents) * 100)}%` }}
          />
        </div>
        {remaining > 0 ? (
          <p className="text-xs text-danger-text">{remaining} student{remaining === 1 ? '' : 's'} still need a seat — add another room.</p>
        ) : spare > 0 ? (
          <p className="text-xs text-text-muted">{spare} spare seat{spare === 1 ? '' : 's'} in the current selection.</p>
        ) : (
          <p className="text-xs text-success-text">Every student has a seat.</p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded border border-border p-3">
        <p className="text-xs font-medium text-text-muted">Rooms in this request — untick to remove.</p>
        {selectedRooms.length === 0 ? (
          <p className="text-sm text-text-muted">No rooms selected yet.</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {selectedRooms.map((r) => (
              <li key={r.roomId}>
                <Checkbox label={roomLabel(r)} checked onChange={() => toggleRoom(r.roomId)} />
              </li>
            ))}
          </ul>
        )}

        {unselectedRooms.length > 0 && (
          <SearchableSelect
            label="Add another room"
            value=""
            onChange={addRoom}
            placeholder={`Choose from all ${usableRooms.length} available rooms…`}
            searchPlaceholder="Search by building or room number…"
            options={unselectedRooms.map((r) => ({ value: r.roomId, label: `Room ${r.roomNumber}`, group: r.building, hint: `${r.capacity} seats` }))}
          />
        )}
      </div>

      <SearchableSelect
        label="Backup room (optional)"
        description="A fallback the admin can swap in if a primary room falls through."
        value={backupRoomId}
        onChange={onChangeBackupRoomId}
        placeholder="No backup room"
        searchPlaceholder="Search by building or room number…"
        options={[
          { value: '', label: 'No backup room' },
          ...backupOptions.map((r) => ({ value: r.roomId, label: `Room ${r.roomNumber}`, group: r.building, hint: `${r.capacity} seats` })),
        ]}
      />
    </div>
  );
}
