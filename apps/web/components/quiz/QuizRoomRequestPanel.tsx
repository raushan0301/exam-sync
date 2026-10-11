'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Alert, SkeletonText, ErrorState } from '@/components/ui';
import { RoomPicker } from '@/components/rooms/RoomPicker';
import { BackupLockChoice, EmptyColumnsQuestion, RoomSuggestionCards } from '@/components/rooms/RoomSuggestionCards';
import type { EmptyColumnsAnswer, LocationChoice } from '@/components/rooms/RoomSuggestionCards';
import { useQuizRoomSuggestions, useQuizRoomConflicts } from '@/lib/queries/useQuizRoomSuggestions';
import { useRequestQuizRooms } from '@/lib/mutations/useQuizMutations';
import { mapError } from '@/lib/error-mapping';
import type { Quiz, RoomSuggestionResult, RoomSuggestionStrategy } from '@/lib/queries/types';

export interface QuizRoomRequestPanelProps {
  quiz: Quiz;
}

/**
 * Faculty-side room suggestion at quiz-creation time (before any exam
 * session exists) — sized against the quiz's own `student_count` +
 * `preferred_date`/`preferred_time`. Shown on the quiz detail page while
 * DRAFT/REJECTED, right alongside Submit for Approval, so the faculty
 * picks a room set + optional backup room and the admin can see it (as a
 * live conflict preview) when reviewing the quiz for approval. This is a
 * preliminary recommendation — the exam session created later re-suggests
 * against the REAL assigned student count before anything is actually
 * booked.
 */
export function QuizRoomRequestPanel({ quiz }: QuizRoomRequestPanelProps) {
  const enabled = quiz.status === 'DRAFT' || quiz.status === 'REJECTED';
  // Asked first: with empty columns only about half of each room's seats are usable, so the rooms suggested differ.
  const [emptyColumns, setEmptyColumns] = useState<EmptyColumnsAnswer>(
    quiz.emptyColumnsPlanned === true ? 'yes' : quiz.emptyColumnsPlanned === false ? 'no' : 'unset',
  );
  const [locationChoice, setLocationChoice] = useState<LocationChoice | null>(null);
  const suggestionsQuery = useQuizRoomSuggestions(quiz.id, enabled && emptyColumns !== 'unset', emptyColumns === 'yes');
  // Same BR-019 student-schedule check the admin sees later at approval
  // time — surfaced here too so the faculty finds out about a real
  // conflict (another exam already booking these students at an
  // overlapping time) before they even submit, not after.
  const conflictsQuery = useQuizRoomConflicts(quiz.id, enabled && !!quiz.preferredDate && !!quiz.preferredTime);
  const requestMutation = useRequestQuizRooms(quiz.id);

  const [selectedStrategy, setSelectedStrategy] = useState<RoomSuggestionStrategy | null>(null);
  const [roomIds, setRoomIds] = useState<string[]>((quiz.requestedRoomIds ?? []));
  const [backupRoomId, setBackupRoomId] = useState<string>(quiz.backupRoomId ?? '');
  const [backupLocked, setBackupLocked] = useState<boolean>(quiz.backupRoomLocked ?? false);
  const [dirty, setDirty] = useState(false);

  const hasExistingRequest = (quiz.requestedRoomIds ?? []).length > 0;
  useEffect(() => {
    if (!suggestionsQuery.data || dirty || hasExistingRequest) return;
    const first = suggestionsQuery.data.strategies.find((s) => s.roomCount > 0) ?? suggestionsQuery.data.strategies[0];
    if (first) {
      setSelectedStrategy(first.strategy);
      // Two ways to place the rooms: the person must choose — nothing is picked for them.
      setLocationChoice(first.alternative ? null : 'together');
      setRoomIds(first.alternative ? [] : first.rooms.map((r) => r.roomId));
    }
  }, [suggestionsQuery.data, dirty, hasExistingRequest]);

  function applyRooms(rooms: { roomId: string }[]) {
    setRoomIds(rooms.map((r) => r.roomId));
    if (rooms.some((r) => r.roomId === backupRoomId)) {
      setBackupRoomId('');
    }
  }

  function pickStrategy(result: RoomSuggestionResult) {
    setDirty(true);
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
    setDirty(true);
    setLocationChoice(choice);
    applyRooms(choice === 'together' || !result.alternative ? result.rooms : result.alternative.rooms);
  }

  async function onSubmitRequest() {
    try {
      await requestMutation.mutateAsync({
        room_ids: roomIds,
        backup_room_id: backupRoomId || undefined,
        backup_locked: backupRoomId ? backupLocked : undefined,
        empty_columns: emptyColumns === 'yes',
        strategy: selectedStrategy ?? undefined,
      });
      setDirty(false);
    } catch {
      // surfaced below via requestMutation.error
    }
  }

  if (!enabled) return null;

  const studentConflicts = conflictsQuery.data?.studentConflicts ?? [];
  const studentConflictBanner = studentConflicts.length > 0 && (
    <Alert color="danger" title="Student schedule conflict (BR-019)">
      <div className="flex flex-col gap-1">
        <p>
          {studentConflicts.length} student{studentConflicts.length === 1 ? ' is' : 's are'} already booked into another exam
          session that overlaps this quiz&apos;s preferred time — change the preferred date/time above, or this will block
          attaching the quiz to a real exam session later.
        </p>
        <ul className="list-disc pl-4 text-xs">
          {studentConflicts.slice(0, 5).map((c, i) => (
            <li key={i}>{c.message}</li>
          ))}
          {studentConflicts.length > 5 && <li>+ {studentConflicts.length - 5} more</li>}
        </ul>
      </div>
    </Alert>
  );

  if (!quiz.studentCount || !quiz.preferredDate || !quiz.preferredTime) {
    return (
      <div className="flex flex-col gap-3">
        {studentConflictBanner}
        <Alert color="info" title="Room suggestions need a few more fields">
          Fill in Number of Students, Preferred Date and Preferred Time above (then save) to see room suggestions.
        </Alert>
      </div>
    );
  }

  const emptyColumnsQuestion = <EmptyColumnsQuestion name={`quiz-empty-columns-${quiz.id}`} value={emptyColumns} onChange={setEmptyColumns} />;

  if (emptyColumns === 'unset') {
    return (
      <div className="flex flex-col gap-3">
        {studentConflictBanner}
        {emptyColumnsQuestion}
      </div>
    );
  }

  if (suggestionsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
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
        {emptyColumnsQuestion}
        <ErrorState title="Couldn't load room suggestions" description={mapped.description} onRetry={() => suggestionsQuery.refetch()} />
      </div>
    );
  }

  const data = suggestionsQuery.data;
  if (!data) return null;

  const alreadySaved = (quiz.requestedRoomIds ?? []).length > 0 && !dirty;

  return (
    <div className="flex flex-col gap-4">
      {studentConflictBanner}
      {emptyColumnsQuestion}

      <p className="text-sm text-text-muted">
        {data.totalStudents} expected student{data.totalStudents === 1 ? '' : 's'} · {data.availableRoomCount} room
        {data.availableRoomCount === 1 ? '' : 's'} available for {quiz.preferredDate.slice(0, 10)}.
      </p>

      {data.shortfall && (
        <Alert color="danger" title="Not enough available room capacity">
          Even using every currently available room, there isn&apos;t enough capacity for all {data.totalStudents} students.
        </Alert>
      )}

      {alreadySaved && (
        <Alert color="success" title="Room request saved">
          Saved with the quiz — it isn&apos;t sent anywhere yet. The admin will see it once you press &quot;Submit for Approval&quot; above. Pick a different strategy or room below to change it.
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
        onChangeRoomIds={(ids) => {
          setDirty(true);
          setRoomIds(ids);
        }}
        backupRoomId={backupRoomId}
        onChangeBackupRoomId={(id) => {
          setDirty(true);
          setBackupRoomId(id);
        }}
      />

      {backupRoomId && (
        <BackupLockChoice
          name={`quiz-backup-lock-${quiz.id}`}
          value={backupLocked}
          onChange={(next) => {
            setDirty(true);
            setBackupLocked(next);
          }}
        />
      )}

      {requestMutation.isError && (
        <Alert color="danger" title="Couldn't submit room request">
          {mapError(requestMutation.error).description}
        </Alert>
      )}

      <div className="flex justify-end">
        <Button onClick={onSubmitRequest} loading={requestMutation.isPending} disabled={roomIds.length === 0 || alreadySaved}>
          {(quiz.requestedRoomIds ?? []).length > 0 ? 'Update Room Request' : 'Save Room Request'}
        </Button>
      </div>
    </div>
  );
}
