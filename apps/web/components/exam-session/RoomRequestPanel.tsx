'use client';

import { useEffect, useState } from 'react';
import { Card, Badge, Button, Alert, SkeletonText, ErrorState } from '@/components/ui';
import { RoomPicker } from '@/components/rooms/RoomPicker';
import { useRoomSuggestions } from '@/lib/queries/useRoomSuggestions';
import { useRequestRooms, useAllocatePreApprovedRooms } from '@/lib/mutations/useRoomAllocationMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, RoomSuggestionResult, RoomSuggestionStrategy } from '@/lib/queries/types';

export interface RoomRequestPanelProps {
  session: ExamSessionDetail;
  readOnly?: boolean;
}

/**
 * Faculty-side room-request builder for the "Rooms" card. Three states:
 * 1. Every actively-attached quiz already has an admin-approved room
 *    (from quiz-approval-time review) — offer straight-to-allocation
 *    using those rooms, skipping a second request/admin-review cycle
 *    entirely (`POST .../rooms/allocate-preapproved`).
 * 2. Otherwise, the three RoomSuggestionService strategies as visual,
 *    explained cards sized against the session's real ASSIGNED student
 *    count and real room availability, letting the faculty pick one (or
 *    hand-adjust which rooms + a single optional backup room), then
 *    submit via `POST .../rooms/request` for admin review.
 * Both branches render directly in this component's own body (not as
 * separate nested function components) — a nested component gets a new
 * type identity every parent render, which makes React remount it,
 * silently dropping in-flight click handlers whenever a background
 * query (e.g. `suggestionsQuery`) settles mid-interaction.
 */
export function RoomRequestPanel({ session, readOnly = false }: RoomRequestPanelProps) {
  const canRequest = session.status === 'ASSIGNING_STUDENTS' && !readOnly;
  const suggestionsQuery = useRoomSuggestions(session.id, canRequest);
  const requestMutation = useRequestRooms(session.id);
  const allocatePreApprovedMutation = useAllocatePreApprovedRooms(session.id);

  // Every actively-attached quiz already went through admin review of its
  // OWN room request at quiz-approval time (QuizRoomConflictPanel) — if
  // every one of them has a non-empty pick, re-running a second full
  // request → admin-review cycle for the exact same rooms is pure
  // friction. Offer straight-to-allocation using those rooms instead of
  // the full suggestion builder below.
  const approvedRoomIds = [...new Set(session.quizzes.flatMap((q) => q.requestedRoomIds ?? []))];
  const approvedBackupRoomIds = [...new Set(session.quizzes.map((q) => q.backupRoomId).filter((id): id is string => !!id))];
  const hasPreApprovedRooms = session.quizzes.length > 0 && session.quizzes.every((q) => (q.requestedRoomIds ?? []).length > 0);

  const [selectedStrategy, setSelectedStrategy] = useState<RoomSuggestionStrategy | null>(null);
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [backupRoomId, setBackupRoomId] = useState<string>('');

  useEffect(() => {
    if (!suggestionsQuery.data) return;
    const first = suggestionsQuery.data.strategies.find((s) => s.roomCount > 0) ?? suggestionsQuery.data.strategies[0];
    if (first) {
      setSelectedStrategy(first.strategy);
      setRoomIds(first.rooms.map((r) => r.roomId));
    }
  }, [suggestionsQuery.data]);

  function pickStrategy(result: RoomSuggestionResult) {
    setSelectedStrategy(result.strategy);
    setRoomIds(result.rooms.map((r) => r.roomId));
    if (result.rooms.some((r) => r.roomId === backupRoomId)) {
      setBackupRoomId('');
    }
  }

  async function onSubmitRequest() {
    try {
      await requestMutation.mutateAsync({
        room_ids: roomIds,
        backup_room_id: backupRoomId || undefined,
        strategy: selectedStrategy ?? undefined,
      });
    } catch {
      // surfaced below via requestMutation.error
    }
  }

  async function onAllocatePreApproved() {
    try {
      await allocatePreApprovedMutation.mutateAsync();
    } catch {
      // surfaced below via allocatePreApprovedMutation.error
    }
  }

  if (session.status === 'ROOM_ALLOCATION') {
    return (
      <Alert color="info" title="Room request pending admin approval">
        {session.roomAllocationStrategy && <>Strategy used: {strategyLabel(session.roomAllocationStrategy)}. </>}
        Waiting for an admin to review live availability and approve or reject this request.
      </Alert>
    );
  }

  if (!canRequest) return null;

  const rejectionBanner = session.roomRejectionReason && (
    <Alert color="danger" title="Room request sent back by admin">
      {session.roomRejectionReason}
    </Alert>
  );

  if (hasPreApprovedRooms) {
    const roomsById = new Map((suggestionsQuery.data?.allRooms ?? []).map((r) => [r.roomId, r]));
    return (
      <div className="flex flex-col gap-3">
        {rejectionBanner}
        <Alert color="info" title="Using the room already approved for this quiz">
          An admin already reviewed and approved this room when approving the quiz — no separate approval needed here.
        </Alert>
        <ul className="flex flex-col gap-2">
          {approvedRoomIds.map((roomId) => {
            const room = roomsById.get(roomId);
            return (
              <li key={roomId} className="rounded border border-border px-3 py-2 text-sm text-text">
                {room ? `${room.building} · Room ${room.roomNumber} (capacity ${room.capacity})` : 'Approved room'}
              </li>
            );
          })}
        </ul>
        {approvedBackupRoomIds.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-text-muted">Backup room (not required)</p>
            <ul className="flex flex-col gap-2">
              {approvedBackupRoomIds.map((roomId) => {
                const room = roomsById.get(roomId);
                return (
                  <li key={roomId} className="rounded border border-dashed border-border px-3 py-2 text-sm text-text-muted">
                    {room ? `${room.building} · Room ${room.roomNumber} (capacity ${room.capacity})` : 'Backup room'}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {allocatePreApprovedMutation.isError && (
          <Alert color="danger" title="Couldn't allocate the approved room">
            {mapError(allocatePreApprovedMutation.error).description}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onAllocatePreApproved} loading={allocatePreApprovedMutation.isPending}>
            Allocate Approved Room
          </Button>
        </div>
      </div>
    );
  }

  if (suggestionsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {rejectionBanner}
        <Card padding="dense">
          <SkeletonText lines={4} />
        </Card>
      </div>
    );
  }

  if (suggestionsQuery.isError) {
    const mapped = mapError(suggestionsQuery.error);
    return (
      <div className="flex flex-col gap-3">
        {rejectionBanner}
        <ErrorState
          title="Couldn't load room suggestions"
          description={mapped.description}
          onRetry={() => suggestionsQuery.refetch()}
        />
      </div>
    );
  }

  const data = suggestionsQuery.data;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      {rejectionBanner}

      <p className="text-sm text-text-muted">
        {data.totalStudents} student{data.totalStudents === 1 ? '' : 's'} assigned to this session · {data.availableRoomCount} room
        {data.availableRoomCount === 1 ? '' : 's'} available for {session.sessionDate.slice(0, 10)}.
      </p>

      {data.shortfall && (
        <Alert color="danger" title="Not enough available room capacity">
          Even using every currently available room, there isn&apos;t enough capacity for all {data.totalStudents} students. You
          can still submit a partial request — mention the shortfall to the admin, or free up more rooms first.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {data.strategies.map((s) => (
          <StrategyCard
            key={s.strategy}
            result={s}
            totalStudents={data.totalStudents}
            selected={selectedStrategy === s.strategy}
            onSelect={() => pickStrategy(s)}
          />
        ))}
      </div>

      <RoomPicker
        allRooms={data.allRooms}
        totalStudents={data.totalStudents}
        roomIds={roomIds}
        onChangeRoomIds={setRoomIds}
        backupRoomId={backupRoomId}
        onChangeBackupRoomId={setBackupRoomId}
      />

      {requestMutation.isError && (
        <Alert color="danger" title="Couldn't submit room request">
          {mapError(requestMutation.error).description}
        </Alert>
      )}

      <div className="flex justify-end">
        <Button onClick={onSubmitRequest} loading={requestMutation.isPending} disabled={roomIds.length === 0}>
          Submit Room Request for Approval
        </Button>
      </div>
    </div>
  );
}

function StrategyCard({
  result,
  totalStudents,
  selected,
  onSelect,
}: {
  result: RoomSuggestionResult;
  totalStudents: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const covers = result.totalCapacity >= totalStudents;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-2 rounded border p-3 text-left transition-colors ${
        selected ? 'border-primary-600 bg-primary-50' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">{result.label}</span>
        {selected && <Badge color="success">Selected</Badge>}
      </div>
      <p className="text-xs text-text-muted">{result.description}</p>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-text-muted">
          <span>{result.roomCount} class{result.roomCount === 1 ? '' : 'es'}</span>
          <span>{result.utilizationPercent}% filled</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className={`h-full rounded-full ${covers ? 'bg-primary-600' : 'bg-danger-600'}`}
            style={{ width: `${Math.min(100, result.utilizationPercent)}%` }}
          />
        </div>
        {!covers && <p className="text-xs text-danger-text">Falls short — only {result.totalCapacity} of {totalStudents} seats.</p>}
      </div>
      <ul className="flex flex-col gap-0.5 text-xs text-text-muted">
        {result.rooms.slice(0, 4).map((r) => (
          <li key={r.roomId}>
            {r.building} {r.roomNumber} — {r.allocated}/{r.capacity}
          </li>
        ))}
        {result.rooms.length > 4 && <li>+ {result.rooms.length - 4} more</li>}
      </ul>
    </button>
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
