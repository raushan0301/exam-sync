'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, ConfirmationDialog } from '@/components/ui';
import { mapError } from '@/lib/error-mapping';
import { useCancelRoomRequest } from '@/lib/mutations/useExtraRoomMutations';
import type { RoomRequest } from '@/lib/queries/types';

const TRIGGER_TEXT: Record<RoomRequest['trigger'], string> = {
  TOO_MANY_STUDENTS: 'Too many students for the open rooms',
  NO_ROOM_FOR_EMPTY_COLUMNS: 'No room left for the empty-column layout',
  OTHER: 'Other',
};

/**
 * Shown in the Rooms step while a "more rooms" request waits for the admin: what was asked, whether each room is still free,
 * and — for the faculty member — a way to withdraw it, which puts the session straight back to seating as it was.
 */
export function RoomRequestPendingPanel({ request, isAdmin }: { request: RoomRequest; isAdmin: boolean }) {
  const cancel = useCancelRoomRequest(request.examSessionId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function onCancel() {
    try {
      await cancel.mutateAsync(request.id);
      setConfirmOpen(false);
    } catch {
      setConfirmOpen(false); // the error shows below
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="room-request-pending">
      <Alert color="warning" title="More rooms requested — seating is paused">
        {isAdmin ? (
          <>
            {request.facultyName} asked for more rooms ({TRIGGER_TEXT[request.trigger].toLowerCase()}). Decide it under{' '}
            <Link href="/admin/room-requests" className="underline">
              Room Requests
            </Link>
            .
          </>
        ) : (
          <>Waiting for an admin to approve or change the rooms below. Seating continues once they decide; you can withdraw the request to carry on right now.</>
        )}
      </Alert>

      <div className="flex flex-col gap-1 rounded border border-border p-3 text-sm">
        <p className="text-xs font-medium text-text-muted">{TRIGGER_TEXT[request.trigger]} — reason given</p>
        <p className="whitespace-pre-wrap text-text">{request.reason}</p>
      </div>

      <ul className="flex flex-col gap-1">
        {request.requestedRooms.map((room) => (
          <li key={room.roomId} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
            <span className="text-text">
              {room.label} <span className="text-text-muted">({room.freeSeats} free seats)</span>
            </span>
            <span className={room.available ? 'text-success-text' : 'text-danger-text'}>{room.available ? 'Locked for you' : room.reason ?? 'Not available'}</span>
          </li>
        ))}
      </ul>

      {cancel.isError && (
        <Alert color="danger" title="Couldn't withdraw the request">
          {mapError(cancel.error).description}
        </Alert>
      )}

      {!isAdmin && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setConfirmOpen(true)} loading={cancel.isPending}>
            Withdraw request
          </Button>
        </div>
      )}

      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Withdraw the request for more rooms?"
        description="The locks on the rooms you asked for are released and the session returns to seating exactly as it was — nothing is lost."
        confirmLabel="Withdraw request"
        loading={cancel.isPending}
        onConfirm={onCancel}
      />
    </div>
  );
}

/** After a decline, the faculty member can read why. */
export function RoomRequestDeclinedNotice({ request }: { request: RoomRequest }) {
  return (
    <Alert color="info" title="Your request for more rooms was declined">
      {request.reviewNote ? <>Admin&apos;s reason: {request.reviewNote}. </> : null}Seating carries on as before.
    </Alert>
  );
}
