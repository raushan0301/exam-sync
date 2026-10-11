'use client';

import { useEffect, useState } from 'react';
import { Modal, Button, Textarea, Alert, Checkbox, SearchableSelect, SkeletonText } from '@/components/ui';
import { EmptyColumnsQuestion, type EmptyColumnsAnswer } from '@/components/rooms/RoomSuggestionCards';
import { mapError } from '@/lib/error-mapping';
import { useExtraRooms } from '@/lib/queries/useRoomRequests';
import { useCreateRoomRequest } from '@/lib/mutations/useExtraRoomMutations';
import type { ExamSessionDetail, ExtraRoomsState } from '@/lib/queries/types';

/** Same minimum the API enforces — a real explanation. */
export const MIN_ROOM_REQUEST_REASON_LENGTH = 10;

export interface RequestMoreRoomsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ExamSessionDetail;
}

/** One line saying why more rooms are needed, in the numbers the faculty member sees on the seating screen. */
function shortfallText(state: ExtraRoomsState): string {
  if (state.seatsNeeded <= 0) return `${state.studentsToPlace} students to place; the open rooms have enough seats for them as things stand.`;
  if (state.emptyColumns && state.studentsToPlace <= state.fullSeats) {
    return `${state.studentsToPlace} students to place, but with empty columns the open rooms have only ${state.usableSeats} usable seats — about ${state.seatsNeeded} more are needed.`;
  }
  return `${state.studentsToPlace} students to place and only ${state.fullSeats} seats in the open rooms — about ${state.seatsNeeded} more are needed.`;
}

/**
 * Ask for more rooms during seating. Sends the session back to the Rooms step (seating pauses) and locks the chosen rooms if
 * they are free; an admin then approves (possibly changing the rooms) or declines. Nobody who has already been told a seat is moved.
 */
export function RequestMoreRoomsDialog({ open, onOpenChange, session }: RequestMoreRoomsDialogProps) {
  const [emptyColumns, setEmptyColumns] = useState<EmptyColumnsAnswer>(
    session.emptyColumnsPlanned === true ? 'yes' : session.emptyColumnsPlanned === false ? 'no' : 'unset',
  );
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const stateQuery = useExtraRooms(session.id, open && emptyColumns !== 'unset', emptyColumns === 'yes');
  const createMutation = useCreateRoomRequest(session.id);
  const state = stateQuery.data;

  // Start from the nearest free rooms, until the faculty member changes the selection themselves.
  useEffect(() => {
    if (state && !touched) setRoomIds(state.suggestion.rooms.map((r) => r.roomId));
  }, [state, touched]);

  const roomsById = new Map((state?.allRooms ?? []).map((r) => [r.roomId, r]));
  const selected = roomIds.map((id) => roomsById.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const selectedSeats = selected.reduce((sum, r) => sum + r.capacity, 0);
  const trimmedLength = reason.trim().length;
  const tooShort = trimmedLength < MIN_ROOM_REQUEST_REASON_LENGTH;
  const canSend = !!state?.canRequest && roomIds.length > 0 && !tooShort;

  function toggle(roomId: string) {
    setTouched(true);
    setRoomIds((prev) => (prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]));
  }

  async function onSend() {
    try {
      await createMutation.mutateAsync({ room_ids: roomIds, reason: reason.trim(), empty_columns: emptyColumns === 'yes' });
      onOpenChange(false);
      setReason('');
      setTouched(false);
    } catch {
      // surfaced below via createMutation.error; the dialog stays open so nothing typed is lost
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) createMutation.reset();
      }}
      title="Request more rooms"
      description="This takes the session back to the Rooms step, so seating pauses until an admin decides. The rooms you choose are locked for you if they are free. If approved, students in rooms that are not finalized are re-split across all of them; rooms already finalized are never touched."
      preventDismiss
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Back
          </Button>
          <Button onClick={onSend} loading={createMutation.isPending} disabled={!canSend}>
            Send Request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {createMutation.isError && (
          <Alert color="danger" title="Couldn't send the request">
            {mapError(createMutation.error).description}
          </Alert>
        )}

        <EmptyColumnsQuestion name={`extra-empty-columns-${session.id}`} value={emptyColumns} onChange={setEmptyColumns} />

        {emptyColumns !== 'unset' && stateQuery.isLoading && <SkeletonText lines={4} />}
        {stateQuery.isError && (
          <Alert color="danger" title="Couldn't load the room options">
            {mapError(stateQuery.error).description}
          </Alert>
        )}

        {state && !state.canRequest && (
          <Alert color="warning" title="More rooms can't be requested right now">
            {state.blockedReason ?? 'A request is already waiting for admin approval.'}
          </Alert>
        )}

        {state?.canRequest && (
          <>
            <p className="text-sm text-text" data-testid="shortfall">
              {shortfallText(state)}
            </p>

            <div className="flex flex-col gap-2 rounded border border-border p-3">
              <p className="text-xs font-medium text-text-muted">
                Nearest free rooms to the ones you use ({state.suggestion.location || 'none free nearby'}) — untick to remove.
              </p>
              {selected.length === 0 ? (
                <p className="text-sm text-text-muted">No rooms selected yet.</p>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {selected.map((r) => (
                    <li key={r.roomId}>
                      <Checkbox label={`${r.building} · Floor ${r.floor} · Room ${r.roomNumber} (${r.capacity} free seats)`} checked onChange={() => toggle(r.roomId)} />
                    </li>
                  ))}
                </ul>
              )}
              <p className={`text-xs ${selectedSeats >= state.seatsNeeded ? 'text-success-text' : 'text-danger-text'}`}>
                {selectedSeats} seat{selectedSeats === 1 ? '' : 's'} selected — {selectedSeats >= state.seatsNeeded ? 'enough for the shortfall.' : `${state.seatsNeeded - selectedSeats} more needed.`}
              </p>
              {state.allRooms.filter((r) => !roomIds.includes(r.roomId)).length > 0 && (
                <SearchableSelect
                  label="Add another room"
                  value=""
                  onChange={(id) => id && toggle(id)}
                  placeholder="Choose from the free rooms…"
                  searchPlaceholder="Search by building or room number…"
                  options={state.allRooms
                    .filter((r) => !roomIds.includes(r.roomId))
                    .map((r) => ({ value: r.roomId, label: `Room ${r.roomNumber}`, group: r.building, hint: `floor ${r.floor} · ${r.capacity} seats` }))}
                />
              )}
            </div>

            <Textarea
              label="Why are more rooms needed?"
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Late additions to the roster, and the open rooms cannot seat everyone."
            />
            <p className="text-xs text-text-muted" aria-live="polite">
              {tooShort ? `At least ${MIN_ROOM_REQUEST_REASON_LENGTH} characters (${trimmedLength}/${MIN_ROOM_REQUEST_REASON_LENGTH}).` : 'Ready to send.'}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
