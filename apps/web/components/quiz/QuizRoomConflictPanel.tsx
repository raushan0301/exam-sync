'use client';

import { useState } from 'react';
import { Card, Alert, Button, Textarea, SkeletonText, ErrorState } from '@/components/ui';
import { RoomAvailabilityCalendar } from '@/components/rooms/RoomAvailabilityCalendar';
import { useQuizRoomConflicts } from '@/lib/queries/useQuizRoomSuggestions';
import { useRequestQuizRooms } from '@/lib/mutations/useQuizMutations';
import { mapError } from '@/lib/error-mapping';
import type { Quiz } from '@/lib/queries/types';

/** "HH:MM" from either a full ISO datetime (preferredTime is stored on the 1970-01-01 base date) or an already-bare "HH:MM[:SS]" string. */
function toHHMM(time: string): string {
  const match = time.match(/(\d{2}:\d{2})/);
  return match ? match[1] : time.slice(0, 5);
}

/** preferred_time + duration_minutes (defaults to 120 when not yet set) as an "HH:MM" end time, for the calendar's highlight window. */
function addMinutesHHMM(time: string, minutes: number): string {
  const [h, m] = toHHMM(time).split(':').map(Number);
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export interface QuizRoomConflictPanelProps {
  quiz: Quiz;
  /** ADMIN only — lets the admin click an alternative to swap out an unavailable/booked room right here, before approving. */
  canSwap?: boolean;
}

/**
 * Room conflict/availability preview shown on the quiz approval screen
 * (SUBMITTED status) — live-checks the faculty's requested + backup room
 * right there, before Approve/Reject. When `canSwap` (ADMIN), an
 * unavailable room's alternatives are clickable — picking one calls
 * `POST /quizzes/{id}/rooms/request` (ADMIN is allowed to call this while
 * SUBMITTED specifically to swap here) to replace it in place, so the
 * admin never has to approve a quiz against a room they can already see
 * is booked. The FULL seat-level allocation still happens later at the
 * exam-session stage (RoomApprovalPanel), once real students are
 * assigned — this only fixes up the preliminary recommendation.
 */
export function QuizRoomConflictPanel({ quiz, canSwap = false }: QuizRoomConflictPanelProps) {
  const enabled = quiz.status === 'SUBMITTED' || quiz.status === 'APPROVED';
  const conflictsQuery = useQuizRoomConflicts(quiz.id, enabled);
  const requestMutation = useRequestQuizRooms(quiz.id);
  const [note, setNote] = useState('');

  if (!enabled) return null;

  if (conflictsQuery.isLoading) {
    return (
      <Card padding="dense">
        <SkeletonText lines={3} />
      </Card>
    );
  }

  if (conflictsQuery.isError) {
    const mapped = mapError(conflictsQuery.error);
    return <ErrorState title="Couldn't load room availability" description={mapped.description} onRetry={() => conflictsQuery.refetch()} />;
  }

  const data = conflictsQuery.data;
  if (!data) return null;

  const hasRoomRequest = (quiz.requestedRoomIds ?? []).length > 0;
  const anyUnavailable = data.requestedRooms.some((r) => !r.available);
  const relevantRoomIds = [
    ...data.requestedRooms.map((r) => r.roomId),
    ...(data.backupRoom ? [data.backupRoom.roomId] : []),
  ];

  async function swapRoom(oldRoomId: string, newRoomId: string) {
    if (!data) return;
    const newRoomIds = data.requestedRooms.map((r) => (r.roomId === oldRoomId ? newRoomId : r.roomId));
    try {
      await requestMutation.mutateAsync({
        room_ids: newRoomIds,
        backup_room_id: data.backupRoom?.roomId,
        strategy: data.strategy ?? undefined,
        admin_note: note.trim() || undefined,
      });
    } catch {
      // surfaced below via requestMutation.error
    }
  }

  async function swapBackupRoom(newRoomId: string | undefined) {
    if (!data) return;
    try {
      await requestMutation.mutateAsync({
        room_ids: data.requestedRooms.map((r) => r.roomId),
        backup_room_id: newRoomId,
        strategy: data.strategy ?? undefined,
        admin_note: note.trim() || undefined,
      });
    } catch {
      // surfaced below via requestMutation.error
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {data.studentConflicts.length > 0 && (
        <Alert color="danger" title="Student schedule conflict (BR-019)">
          <div className="flex flex-col gap-1">
            <p>
              {data.studentConflicts.length} student{data.studentConflicts.length === 1 ? ' is' : 's are'} already booked into
              another exam session that overlaps this quiz&apos;s preferred time — attaching this quiz to a real exam session at
              that slot will fail until it&apos;s rescheduled.
            </p>
            <ul className="list-disc pl-4 text-xs">
              {data.studentConflicts.slice(0, 5).map((c, i) => (
                <li key={i}>{c.message}</li>
              ))}
              {data.studentConflicts.length > 5 && <li>+ {data.studentConflicts.length - 5} more</li>}
            </ul>
          </div>
        </Alert>
      )}

      {!hasRoomRequest && (
        <Alert color="neutral" title="No room request submitted">
          This faculty did not submit a preliminary room request for this quiz.
        </Alert>
      )}

      {hasRoomRequest && quiz.preferredDate && quiz.preferredTime && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-text-muted">
            Requested/backup room bookings on {quiz.preferredDate.slice(0, 10)} — this quiz&apos;s requested window is highlighted.
          </p>
          <RoomAvailabilityCalendar
            date={quiz.preferredDate.slice(0, 10)}
            roomIds={relevantRoomIds}
            highlightRange={{
              startTime: toHHMM(quiz.preferredTime),
              endTime: addMinutesHHMM(quiz.preferredTime, quiz.durationMinutes ?? 120),
            }}
          />
        </div>
      )}

      {hasRoomRequest && anyUnavailable && (
        <Alert color="warning" title="One or more requested rooms are no longer available">
          {canSwap
            ? 'Pick an alternative below to swap it in, or reject and let the faculty resubmit.'
            : 'Consider this before approving — the faculty will re-request rooms at the exam-session stage regardless.'}
        </Alert>
      )}

      {requestMutation.isError && (
        <Alert color="danger" title="Couldn't swap room">
          {mapError(requestMutation.error).description}
        </Alert>
      )}

      {hasRoomRequest && canSwap && (
        <Textarea
          label="Note to faculty (optional)"
          description="Shown on their quiz page if you swap or remove a room below."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Backup room removed — it was double-booked for that slot."
        />
      )}

      {hasRoomRequest && (
      <>
      <ul className="flex flex-col gap-2">
        {data.requestedRooms.map((r) => (
          <li key={r.roomId} className="flex flex-col gap-1 rounded border border-border p-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text">
                {r.building} · Room {r.roomNumber} (capacity {r.capacity})
              </span>
              <span className={r.available ? 'text-success-text' : 'text-danger-text'}>{r.available ? 'Available' : 'Unavailable'}</span>
            </div>
            {!r.available && (
              <div className="pl-1 text-xs text-text-muted">
                <p>{r.reason}</p>
                {r.alternatives && r.alternatives.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span>{canSwap ? 'Swap in:' : 'Alternatives:'}</span>
                    {r.alternatives.map((alt) =>
                      canSwap ? (
                        <Button
                          key={alt.roomId}
                          size="sm"
                          variant="secondary"
                          onClick={() => swapRoom(r.roomId, alt.roomId)}
                          loading={requestMutation.isPending}
                        >
                          {alt.building} {alt.roomNumber} ({alt.capacity})
                        </Button>
                      ) : (
                        <span key={alt.roomId}>
                          {alt.building} {alt.roomNumber} ({alt.capacity})
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {data.backupRoom && (
        <div className="rounded border border-border p-2 text-sm">
          <p className="text-xs font-medium text-text-muted">Backup room (faculty-nominated)</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-text">
              {data.backupRoom.building} · Room {data.backupRoom.roomNumber} (capacity {data.backupRoom.capacity})
            </span>
            <div className="flex items-center gap-2">
              <span className={data.backupRoom.available ? 'text-success-text' : 'text-danger-text'}>
                {data.backupRoom.available ? 'Available' : 'Unavailable'}
              </span>
              {canSwap && (
                <Button size="sm" variant="destructive" onClick={() => swapBackupRoom(undefined)} loading={requestMutation.isPending}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          {!data.backupRoom.available && data.backupRoom.alternatives && data.backupRoom.alternatives.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-2 pl-1 text-xs text-text-muted">
              <span>{canSwap ? 'Swap in:' : 'Alternatives:'}</span>
              {data.backupRoom.alternatives.map((alt) =>
                canSwap ? (
                  <Button key={alt.roomId} size="sm" variant="secondary" onClick={() => swapBackupRoom(alt.roomId)} loading={requestMutation.isPending}>
                    {alt.building} {alt.roomNumber} ({alt.capacity})
                  </Button>
                ) : (
                  <span key={alt.roomId}>
                    {alt.building} {alt.roomNumber} ({alt.capacity})
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
