'use client';

import { useState } from 'react';
import { Card, StatusBadge, Button, Alert, SkeletonText, ErrorState, ConfirmationDialog } from '@/components/ui';
import { useExamSession } from '@/lib/queries/useExamSession';
import { mapError } from '@/lib/error-mapping';
import { useCheckExamSessionConflicts } from '@/lib/mutations/useExamSessionMutations';
import { useStartExamSession, useCompleteExamSession } from '@/lib/mutations/useExamSessionLifecycleMutations';
import { SessionStatusProgress } from './SessionStatusProgress';
import { QuizAttachPanel } from './QuizAttachPanel';
import { RescheduleModal } from './RescheduleModal';
import { CancelDialog } from './CancelDialog';
import { ConflictResultDisplay } from './ConflictResultDisplay';
import { RoomAllocationPanel } from './RoomAllocationPanel';
import { RosterPanel } from './RosterPanel';
import { SeatingPanel } from './SeatingPanel';
import { InvigilatorPanel } from './InvigilatorPanel';
import { AttendanceOverviewPanel } from './AttendanceOverviewPanel';

const NON_CANCELLABLE_STATUSES = new Set(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

export interface ExamSessionDetailViewProps {
  sessionId: string;
}

/**
 * Admin exam-session detail hub: session info + StatusBadge + a
 * non-interactive progress indicator, attached quizzes (attach/detach),
 * read-only rooms, Reschedule, Cancel, and Check Conflicts.
 */
export function ExamSessionDetailView({ sessionId }: ExamSessionDetailViewProps) {
  const sessionQuery = useExamSession(sessionId);
  const conflictsMutation = useCheckExamSessionConflicts(sessionId);
  const startMutation = useStartExamSession(sessionId);
  const completeMutation = useCompleteExamSession(sessionId);

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  if (sessionQuery.isLoading) {
    return (
      <Card>
        <SkeletonText lines={6} />
      </Card>
    );
  }

  if (sessionQuery.isError) {
    const mapped = mapError(sessionQuery.error);
    return (
      <ErrorState
        title={mapped.kind === 'not-found' || mapped.kind === 'forbidden' ? "Couldn't load this exam session" : mapped.title}
        description={mapped.description}
        onRetry={() => sessionQuery.refetch()}
      />
    );
  }

  const session = sessionQuery.data;
  if (!session) return null;

  const canReschedule = session.status === 'DRAFT';
  const canCancel = !NON_CANCELLABLE_STATUSES.has(session.status);
  const canStart = session.status === 'READY_FOR_FINALIZATION';
  const canComplete = session.status === 'IN_PROGRESS';

  async function onStart() {
    try {
      await startMutation.mutateAsync();
      setStartOpen(false);
    } catch {
      setStartOpen(false);
    }
  }
  async function onComplete() {
    try {
      await completeMutation.mutateAsync();
      setCompleteOpen(false);
    } catch {
      setCompleteOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        header={
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-text">{session.name}</h1>
            <StatusBadge status={session.status} />
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => conflictsMutation.mutate()} loading={conflictsMutation.isPending}>
              Check Conflicts
            </Button>
            {canReschedule && (
              <Button variant="secondary" onClick={() => setRescheduleOpen(true)}>
                Reschedule
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel Session
              </Button>
            )}
          </div>
        }
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-text-muted">Date</dt>
            <dd className="text-text">{session.sessionDate.slice(0, 10)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Time</dt>
            <dd className="text-text">
              {session.startTime.slice(11, 16) || session.startTime.slice(0, 5)} – {session.endTime.slice(11, 16) || session.endTime.slice(0, 5)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card
        header={<h2 className="text-sm font-semibold text-text">Progress</h2>}
        padding="dense"
        footer={
          (canStart || canComplete) && (
            <div className="flex justify-end gap-2">
              {canStart && (
                <Button onClick={() => setStartOpen(true)} loading={startMutation.isPending}>
                  Start Exam Session
                </Button>
              )}
              {canComplete && (
                <Button onClick={() => setCompleteOpen(true)} loading={completeMutation.isPending}>
                  Complete Exam Session
                </Button>
              )}
            </div>
          )
        }
      >
        <SessionStatusProgress status={session.status} />
        {startMutation.isError && (
          <Alert color="danger" title="Couldn't start exam session" className="mt-3">
            {mapError(startMutation.error).description}
          </Alert>
        )}
        {completeMutation.isError && (
          <Alert color="danger" title="Couldn't complete exam session" className="mt-3">
            {mapError(completeMutation.error).description}
          </Alert>
        )}
      </Card>

      {conflictsMutation.isSuccess && (
        <Card header={<h2 className="text-sm font-semibold text-text">Conflict Check Result</h2>} padding="dense">
          <ConflictResultDisplay hard={conflictsMutation.data.hard} warnings={conflictsMutation.data.warnings} />
        </Card>
      )}
      {conflictsMutation.isError && (
        <Alert color="danger" title="Couldn't check conflicts">
          {mapError(conflictsMutation.error).description}
        </Alert>
      )}

      <Card header={<h2 className="text-sm font-semibold text-text">Quizzes</h2>} padding="dense">
        <QuizAttachPanel session={session} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Rooms</h2>} padding="dense">
        <div className="flex flex-col gap-3">
          <RoomAllocationPanel session={session} />
          {session.rooms.length === 0 ? (
            <p className="text-sm text-text-muted">No rooms allocated yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {session.rooms.map((room) => (
                <li key={room.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
                  <span className="text-text">
                    {room.building} · Floor {room.floor} · Room {room.roomNumber}
                  </span>
                  <span className="text-text-muted">
                    {room.allocatedCapacity} / {room.capacity} seats
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Roster</h2>} padding="dense">
        <RosterPanel session={session} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Seating</h2>} padding="dense">
        <SeatingPanel session={session} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Invigilators</h2>} padding="dense">
        <InvigilatorPanel session={session} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Attendance Overview</h2>} padding="dense">
        <AttendanceOverviewPanel session={session} />
      </Card>

      <RescheduleModal open={rescheduleOpen} onOpenChange={setRescheduleOpen} session={session} />
      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} sessionId={session.id} sessionName={session.name} />

      <ConfirmationDialog
        open={startOpen}
        onOpenChange={(next) => {
          setStartOpen(next);
          if (!next) startMutation.reset();
        }}
        title="Start Exam Session"
        description="This transitions the session to IN_PROGRESS, allowing invigilators to begin marking attendance. Every allocated room must already have a finalized seating plan."
        confirmLabel="Start"
        loading={startMutation.isPending}
        onConfirm={onStart}
      />
      <ConfirmationDialog
        open={completeOpen}
        onOpenChange={(next) => {
          setCompleteOpen(next);
          if (!next) completeMutation.reset();
        }}
        title="Complete Exam Session"
        description="This transitions the session to COMPLETED and locks every attendance record for this session — further status changes will require a reason. This cannot be undone."
        confirmLabel="Complete"
        loading={completeMutation.isPending}
        onConfirm={onComplete}
      />
    </div>
  );
}
