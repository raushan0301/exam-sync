'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Alert, SkeletonText, ErrorState } from '@/components/ui';
import { RoomPicker } from '@/components/rooms/RoomPicker';
import { EmptyColumnsQuestion, RoomSuggestionCards, roomStrategyLabel } from '@/components/rooms/RoomSuggestionCards';
import type { EmptyColumnsAnswer, LocationChoice } from '@/components/rooms/RoomSuggestionCards';
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
  const [emptyColumns, setEmptyColumns] = useState<EmptyColumnsAnswer>('unset');
  const [locationChoice, setLocationChoice] = useState<LocationChoice | null>(null);
  const hasApprovedRooms = session.quizzes.length > 0 && session.quizzes.every((q) => (q.requestedRoomIds ?? []).length > 0);
  // The approved-room shortcut still needs the room list for display (columns do not matter there); the suggestion builder asks first.
  const suggestionsQuery = useRoomSuggestions(session.id, canRequest && (hasApprovedRooms || emptyColumns !== 'unset'), emptyColumns === 'yes');
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
      // Two ways to place the rooms: the person must choose — nothing is picked for them.
      setLocationChoice(first.alternative ? null : 'together');
      setRoomIds(first.alternative ? [] : first.rooms.map((r) => r.roomId));
    }
  }, [suggestionsQuery.data]);

  function applyRooms(rooms: { roomId: string }[]) {
    setRoomIds(rooms.map((r) => r.roomId));
    if (rooms.some((r) => r.roomId === backupRoomId)) {
      setBackupRoomId('');
    }
  }

  function pickStrategy(result: RoomSuggestionResult) {
    setSelectedStrategy(result.strategy);
    if (result.alternative) {
      setLocationChoice(null);
      setRoomIds([]);
    } else {
      setLocationChoice('together');
      applyRooms(result.rooms);
    }
  }

  function chooseLocation(result: RoomSuggestionResult, choice: LocationChoice) {
    setLocationChoice(choice);
    applyRooms(choice === 'together' || !result.alternative ? result.rooms : result.alternative.rooms);
  }

  async function onSubmitRequest() {
    try {
      await requestMutation.mutateAsync({
        room_ids: roomIds,
        backup_room_id: backupRoomId || undefined,
        empty_columns: emptyColumns === 'yes',
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
        {session.roomAllocationStrategy && <>Strategy used: {roomStrategyLabel(session.roomAllocationStrategy)}. </>}
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

  const emptyColumnsQuestion = <EmptyColumnsQuestion name={`session-empty-columns-${session.id}`} value={emptyColumns} onChange={setEmptyColumns} />;

  if (emptyColumns === 'unset') {
    return (
      <div className="flex flex-col gap-3">
        {rejectionBanner}
        {emptyColumnsQuestion}
      </div>
    );
  }

  if (suggestionsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {rejectionBanner}
        {emptyColumnsQuestion}
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
        {emptyColumnsQuestion}
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
      {emptyColumnsQuestion}

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

      <RoomSuggestionCards
        strategies={data.strategies}
        totalStudents={data.totalStudents}
        selectedStrategy={selectedStrategy}
        locationChoice={locationChoice}
        onPickStrategy={pickStrategy}
        onChooseLocation={chooseLocation}
      />

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
