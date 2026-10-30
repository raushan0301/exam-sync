'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Alert, Checkbox, SkeletonText, ErrorState, Textarea, Modal } from '@/components/ui';
import { SharedRoomNote } from '@/components/rooms/SharedRoomNote';
import { useRoomAvailabilityPreview } from '@/lib/queries/useRoomAvailabilityPreview';
import { useAllocateRooms, useRejectRoomRequest } from '@/lib/mutations/useRoomAllocationMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail } from '@/lib/queries/types';

export interface RoomApprovalPanelProps {
  session: ExamSessionDetail;
}

/**
 * Admin review screen for a pending room request (session status
 * ROOM_ALLOCATION): shows live availability for every requested + backup
 * room (`GET .../rooms/preview`), lets the admin swap in an alternative
 * for anything unavailable, then approve (`POST .../rooms/allocate`,
 * finalizing the exact room set) or reject with a reason (`POST
 * .../rooms/reject`, sending it back to the faculty).
 */
export function RoomApprovalPanel({ session }: RoomApprovalPanelProps) {
  const enabled = session.status === 'ROOM_ALLOCATION';
  const previewQuery = useRoomAvailabilityPreview(session.id, enabled);
  const allocateMutation = useAllocateRooms(session.id);
  const rejectMutation = useRejectRoomRequest(session.id);

  const [finalRoomIds, setFinalRoomIds] = useState<string[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!previewQuery.data) return;
    const defaults = previewQuery.data.requestedRooms
      .filter((r) => r.available)
      .map((r) => r.roomId);
    setFinalRoomIds(defaults);
  }, [previewQuery.data]);

  function toggle(roomId: string) {
    setFinalRoomIds((prev) => (prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]));
  }

  async function onApprove() {
    try {
      await allocateMutation.mutateAsync({ room_ids: finalRoomIds });
    } catch {
      // surfaced below
    }
  }

  async function onReject() {
    try {
      await rejectMutation.mutateAsync(rejectReason);
      setRejectOpen(false);
      setRejectReason('');
    } catch {
      // keep the dialog open, surfaced via rejectMutation.error
    }
  }

  if (!enabled) return null;

  if (previewQuery.isLoading) {
    return (
      <Card padding="dense">
        <SkeletonText lines={4} />
      </Card>
    );
  }

  if (previewQuery.isError) {
    const mapped = mapError(previewQuery.error);
    return <ErrorState title="Couldn't load room availability" description={mapped.description} onRetry={() => previewQuery.refetch()} />;
  }

  const data = previewQuery.data;
  if (!data) return null;

  const anyUnavailable = data.requestedRooms.some((r) => !r.available);

  return (
    <div className="flex flex-col gap-3">
      <Alert color="warning" title="Pending your approval">
        Faculty requested these rooms{data.strategy ? ` using the "${strategyLabel(data.strategy)}" strategy` : ''}. Review live
        availability below — unavailable rooms are flagged with a same-or-greater-capacity alternative.
      </Alert>

      {anyUnavailable && (
        <Alert color="danger" title="One or more requested rooms are no longer available">
          They&apos;ve been unchecked below — pick an alternative or a different room before approving.
        </Alert>
      )}

      <ul className="flex flex-col gap-2">
        {data.requestedRooms.map((r) => (
          <li key={r.roomId} className="flex flex-col gap-1 rounded border border-border p-2">
            <div className="flex items-center justify-between">
              <Checkbox
                label={`${r.building} · Room ${r.roomNumber} (capacity ${r.capacity})`}
                checked={finalRoomIds.includes(r.roomId)}
                onChange={() => toggle(r.roomId)}
              />
              <span className={`text-xs ${r.available ? 'text-success-text' : 'text-danger-text'}`}>
                {r.available ? 'Available' : 'Unavailable'}
              </span>
            </div>
            <SharedRoomNote sharedWith={r.sharedWith} className="pl-7 text-xs text-info-text" />
            {!r.available && (
              <div className="pl-7 text-xs text-text-muted">
                <p>{r.reason}</p>
                {r.alternatives && r.alternatives.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span>Swap in:</span>
                    {r.alternatives.map((alt) => (
                      <button
                        key={alt.roomId}
                        type="button"
                        className="rounded border border-border px-2 py-0.5 text-text hover:border-primary-600"
                        onClick={() => setFinalRoomIds((prev) => [...prev.filter((id) => id !== r.roomId), alt.roomId])}
                      >
                        {alt.building} {alt.roomNumber} ({alt.capacity})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {data.backupRoom && (
        <div className="rounded border border-border p-2">
          <p className="text-xs font-medium text-text-muted">Backup room (faculty-nominated)</p>
          <div className="mt-1 flex items-center justify-between">
            <Checkbox
              label={`${data.backupRoom.building} · Room ${data.backupRoom.roomNumber} (capacity ${data.backupRoom.capacity})`}
              checked={finalRoomIds.includes(data.backupRoom.roomId)}
              onChange={() => toggle(data.backupRoom!.roomId)}
              disabled={!data.backupRoom.available}
            />
            <span className={`text-xs ${data.backupRoom.available ? 'text-success-text' : 'text-danger-text'}`}>
              {data.backupRoom.available ? 'Available' : 'Unavailable'}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">Uncheck above to drop the backup room from this approval entirely.</p>
        </div>
      )}

      {allocateMutation.isError && (
        <Alert color="danger" title="Couldn't approve room allocation">
          {mapError(allocateMutation.error).description}
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={allocateMutation.isPending}>
          Reject
        </Button>
        <Button onClick={onApprove} loading={allocateMutation.isPending} disabled={finalRoomIds.length === 0}>
          Approve
        </Button>
      </div>

      <Modal
        open={rejectOpen}
        onOpenChange={(next) => {
          setRejectOpen(next);
          if (!next) rejectMutation.reset();
        }}
        title="Reject Room Request"
        description="Sends this request back to the faculty so they can submit a different one. They'll see your reason."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)} disabled={rejectMutation.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onReject} loading={rejectMutation.isPending} disabled={!rejectReason.trim()}>
              Reject Request
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {rejectMutation.isError && (
            <Alert color="danger" title="Couldn't reject room request">
              {mapError(rejectMutation.error).description}
            </Alert>
          )}
          <Textarea
            label="Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Requested rooms are too far apart for one invigilator team."
          />
        </div>
      </Modal>
    </div>
  );
}

function strategyLabel(strategy: string): string {
  switch (strategy) {
    case 'FEWEST_ROOMS':
      return 'Fewest Classes';
    case 'SEQUENTIAL':
      return 'Sequential (Adjacent Rooms)';
    case 'BALANCED_SPREAD':
      return 'Balanced Spread';
    default:
      return strategy;
  }
}
