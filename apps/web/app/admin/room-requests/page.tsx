'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Checkbox, Drawer, ErrorState, Pagination, SearchableSelect, SkeletonText, StatusBadge, Textarea } from '@/components/ui';
import { cn } from '@/components/ui/utils';
import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { useCursorPager } from '@/components/data-table/useCursorPager';
import { useRoomRequest, useRoomRequests } from '@/lib/queries/useRoomRequests';
import { useApproveRoomRequest, useRejectExtraRoomRequest } from '@/lib/mutations/useExtraRoomMutations';
import { mapError } from '@/lib/error-mapping';
import type { RoomRequest, RoomRequestStatus } from '@/lib/queries/types';

const TABS: { value: RoomRequestStatus | ''; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Declined' },
  { value: 'CANCELLED', label: 'Withdrawn' },
  { value: '', label: 'All' },
];

const TRIGGER_TEXT: Record<RoomRequest['trigger'], string> = {
  TOO_MANY_STUDENTS: 'Too many students for the open rooms',
  NO_ROOM_FOR_EMPTY_COLUMNS: 'No room left for the empty-column layout',
  OTHER: 'Other',
};

const PAGE_SIZE = 25;
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (iso: string) => new Date(iso).toLocaleString();

function ReviewDrawer({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const detailQuery = useRoomRequest(requestId);
  const approve = useApproveRoomRequest();
  const reject = useRejectExtraRoomRequest();
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const request = detailQuery.data;
  const pending = request?.status === 'PENDING';
  const busy = approve.isPending || reject.isPending;

  // Start from the asked-for rooms that are still free; the admin may untick or add others.
  useEffect(() => {
    if (request && request.status === 'PENDING') setChosen(request.requestedRooms.filter((r) => r.available).map((r) => r.roomId));
  }, [request?.id, request?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: 'approve' | 'reject') {
    setError(null);
    try {
      if (action === 'approve') await approve.mutateAsync({ id: requestId, room_ids: chosen, note: note.trim() || undefined });
      else await reject.mutateAsync({ id: requestId, note: note.trim() });
      onClose();
    } catch (err) {
      setError(mapError(err).description);
    }
  }

  const known = new Map<string, string>([
    ...(request?.requestedRooms ?? []).map((r) => [r.roomId, `${r.label} (${r.freeSeats} free seats)`] as [string, string]),
    ...(request?.options ?? []).map((o) => [o.roomId, `${o.building}-${o.roomNumber} (${o.capacity} free seats)`] as [string, string]),
  ]);
  const notFinalized = request?.currentRooms.filter((r) => !r.finalized) ?? [];

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()} title="Request for more rooms" description={request?.examSessionName}>
      <div className="flex flex-col gap-4 p-4">
        {detailQuery.isLoading && <SkeletonText lines={6} />}
        {detailQuery.isError && <Alert color="danger">{mapError(detailQuery.error).description}</Alert>}
        {request && (
          <>
            <div className="flex items-center gap-2">
              <StatusBadge status={request.status} />
              <StatusBadge status={request.examSessionStatus} />
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Exam session</dt>
                <dd className="mt-1 text-text">
                  <Link href={`/admin/exam-sessions/${request.examSessionId}`} className="underline">
                    {request.examSessionName}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Scheduled</dt>
                <dd className="mt-1 text-text">{date(request.examSessionDate)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Requested by</dt>
                <dd className="mt-1 text-text">
                  {request.facultyName} ({request.facultyEmployeeCode})
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Why</dt>
                <dd className="mt-1 text-text">{TRIGGER_TEXT[request.trigger]}</dd>
              </div>
            </dl>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Faculty&apos;s reason</p>
              <p className="mt-1 whitespace-pre-wrap rounded border border-border bg-surface-muted p-3 text-sm text-text">{request.reason}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Rooms in the session now</p>
              <ul className="mt-1 flex flex-col gap-1" data-testid="current-rooms">
                {request.currentRooms.map((room) => (
                  <li key={room.roomId} className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm">
                    <span className="text-text">
                      {room.label} <span className="text-text-muted">({room.allocated} students)</span>
                    </span>
                    <span className={room.finalized ? 'text-success-text' : 'text-text-muted'}>{room.finalized ? 'Finalized — untouched' : 'Will be re-split'}</span>
                  </li>
                ))}
              </ul>
            </div>

            {pending ? (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Rooms to add — change them if needed</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {request.requestedRooms.map((room) => (
                      <li key={room.roomId} className="flex items-center justify-between gap-2 rounded border border-border px-3 py-1.5 text-sm">
                        <Checkbox label={`${room.label} (${room.freeSeats} free seats)`} checked={chosen.includes(room.roomId)} onChange={() => setChosen((c) => (c.includes(room.roomId) ? c.filter((id) => id !== room.roomId) : [...c, room.roomId]))} />
                        <span className={room.available ? 'text-success-text' : 'text-danger-text'}>{room.available ? 'Free' : room.reason ?? 'Not available'}</span>
                      </li>
                    ))}
                    {chosen
                      .filter((id) => !request.requestedRooms.some((r) => r.roomId === id))
                      .map((id) => (
                        <li key={id} className="flex items-center justify-between gap-2 rounded border border-primary-200 px-3 py-1.5 text-sm">
                          <Checkbox label={`${known.get(id) ?? 'Room'} — your swap`} checked onChange={() => setChosen((c) => c.filter((x) => x !== id))} />
                        </li>
                      ))}
                  </ul>
                  {request.options.filter((o) => !chosen.includes(o.roomId) && !request.requestedRooms.some((r) => r.roomId === o.roomId)).length > 0 && (
                    <div className="mt-2">
                      <SearchableSelect
                        label="Swap in another free room"
                        value=""
                        onChange={(id) => id && setChosen((c) => [...c, id])}
                        placeholder="Choose from the free rooms…"
                        searchPlaceholder="Search by building or room number…"
                        options={request.options
                          .filter((o) => !chosen.includes(o.roomId) && !request.requestedRooms.some((r) => r.roomId === o.roomId))
                          .map((o) => ({ value: o.roomId, label: `Room ${o.roomNumber}`, group: o.building, hint: `floor ${o.floor} · ${o.capacity} seats` }))}
                      />
                    </div>
                  )}
                </div>

                <Alert color="info" title="What approving does">
                  The chosen rooms are added, and the {request.studentsToPlace} students who are not in a finalized room are re-split across{' '}
                  {notFinalized.map((r) => r.label).join(', ') || 'the open rooms'} and the new rooms, so every room keeps a mix of subjects. Those rooms&apos; seating is cleared —
                  the faculty member generates it again. Finalized rooms are never touched.
                </Alert>
                {error && <Alert color="danger">{error}</Alert>}
                <Textarea
                  label="Note to the faculty member"
                  description="Optional when approving. Required when declining — they will see it."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => run('reject')} loading={reject.isPending} disabled={busy || !note.trim()}>
                    Decline Request
                  </Button>
                  <Button onClick={() => run('approve')} loading={approve.isPending} disabled={busy || chosen.length === 0}>
                    Approve &amp; Add Rooms
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {request.status === 'APPROVED' ? 'Approved' : request.status === 'REJECTED' ? 'Declined' : 'Withdrawn'}
                  {request.reviewedAt ? ` on ${dateTime(request.reviewedAt)}` : ''}
                </p>
                {request.status === 'APPROVED' && <p className="mt-1 text-sm text-text">Rooms added: {request.approvedRoomLabels.join(', ') || '—'}</p>}
                <p className="mt-1 text-sm text-text">{request.reviewNote || (request.status === 'CANCELLED' ? 'The faculty member withdrew this request.' : 'No note was added.')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

/**
 * ADMIN queue for faculty requests for more rooms during seating. Approving adds the rooms and re-splits the students of rooms
 * that are not finalized; declining sends the session back to seating as it was.
 */
export default function AdminRoomRequestsPage() {
  const [status, setStatus] = useState<RoomRequestStatus | ''>('PENDING');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pager = useCursorPager();

  const { data, isLoading, isError, refetch, isFetching } = useRoomRequests({ status: status || undefined, cursor: pager.cursor, limit: PAGE_SIZE });
  const items = data?.items ?? [];

  function onTab(next: RoomRequestStatus | '') {
    setStatus(next);
    pager.reset();
  }

  const columns: DataTableColumn<RoomRequest>[] = [
    {
      key: 'session',
      header: 'Exam Session',
      render: (r) => (
        <span className="flex flex-col">
          <span className="font-medium text-text">{r.examSessionName}</span>
          <span className="text-xs text-text-muted">{date(r.examSessionDate)}</span>
        </span>
      ),
    },
    { key: 'faculty', header: 'Requested By', render: (r) => `${r.facultyName} (${r.facultyEmployeeCode})` },
    { key: 'why', header: 'Why', render: (r) => TRIGGER_TEXT[r.trigger] },
    { key: 'rooms', header: 'Rooms Asked', render: (r) => r.requestedRooms.map((x) => x.label).join(', ') || '—' },
    { key: 'requested', header: 'Requested', render: (r) => dateTime(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Room Requests</h1>
        <p className="text-sm text-text-muted">
          Faculty ask for more rooms during seating. Approving adds the rooms and re-splits the students of rooms that are not finalized; finalized rooms are never touched.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-muted p-1" role="tablist" aria-label="Filter by status">
        {TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => onTab(tab.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              status === tab.value ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isError ? (
        <ErrorState title="Couldn't load room requests" onRetry={() => refetch()} retrying={isFetching} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={items}
            getRowKey={(r) => r.id}
            isLoading={isLoading}
            isError={false}
            emptyTitle={status === 'PENDING' ? 'No requests waiting for review' : 'No room requests here'}
            emptyDescription={status === 'PENDING' ? 'New requests from faculty will appear here.' : 'Try another status.'}
            renderActions={(r) => (
              <Button size="sm" variant={r.status === 'PENDING' ? 'primary' : 'secondary'} onClick={() => setSelectedId(r.id)}>
                {r.status === 'PENDING' ? 'Review' : 'View'}
              </Button>
            )}
          />
          <Pagination hasNext={!!data?.next_cursor} hasPrev={pager.hasPrev} onNext={() => pager.goNext(data?.next_cursor)} onPrev={pager.goPrev} />
        </>
      )}

      {selectedId && <ReviewDrawer requestId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
