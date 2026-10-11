'use client';

import { useState } from 'react';
import { Card, StatusBadge, Button, Alert, SkeletonText, ErrorState, ConfirmationDialog } from '@/components/ui';
import { useExamSession } from '@/lib/queries/useExamSession';
import { useSessionInvigilators } from '@/lib/queries/useInvigilationDuties';
import { mapError } from '@/lib/error-mapping';
import { formatTimeRange } from '@/lib/format-time';
import { useCheckExamSessionConflicts } from '@/lib/mutations/useExamSessionMutations';
import { useStartExamSession, useCompleteExamSession } from '@/lib/mutations/useExamSessionLifecycleMutations';
import { SessionStatusProgress } from './SessionStatusProgress';
import { QuizAttachPanel } from './QuizAttachPanel';
import { RescheduleModal } from './RescheduleModal';
import { SuspensionRequestDialog } from './SuspensionRequestDialog';
import { SuspensionStatusBanner } from './SuspensionStatusBanner';
import { useSuspensionRequests } from '@/lib/queries/useSuspensionRequests';
import { ConflictResultDisplay } from './ConflictResultDisplay';
import { RoomRequestPanel } from './RoomRequestPanel';
import { RoomApprovalPanel } from './RoomApprovalPanel';
import { RosterPanel } from './RosterPanel';
import { SeatingPanel } from './SeatingPanel';
import { InvigilatorPanel } from './InvigilatorPanel';
import { AttendanceOverviewPanel } from './AttendanceOverviewPanel';

const NON_CANCELLABLE_STATUSES = new Set(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

export interface ExamSessionDetailViewProps {
  sessionId: string;
  /**
   * Faculty-lifecycle-ownership change: FACULTY now exclusively drives the
   * whole lifecycle (quiz attach/detach, reschedule, cancel, assign
   * students, room allocation, seating, invigilators) for sessions built
   * from their own quizzes; ADMIN keeps full read-only visibility into
   * every session, unscoped, but every action control below is hidden for
   * them — mirrors `QuizDetailView`'s existing `role` prop precedent.
   * Defaults to `'FACULTY'` for backward compatibility with any caller
   * that hasn't been updated yet.
   */
  role?: 'ADMIN' | 'FACULTY';
}

/**
 * Exam-session detail hub, shared by the admin (read-only) and faculty
 * (fully actionable) routes: session info + StatusBadge + a visual
 * progress stepper, attached quizzes, rooms, roster, seating,
 * invigilators, and attendance. See `role` above for what differs.
 */
export function ExamSessionDetailView({ sessionId, role = 'FACULTY' }: ExamSessionDetailViewProps) {
  const readOnly = role === 'ADMIN';
  const sessionQuery = useExamSession(sessionId);
  // Shares InvigilatorPanel's own cached query (same key) — no extra
  // request, just reads the same data to drive the progress stepper's
  // "Assign Invigilator" step below.
  const invigilatorsForProgress = useSessionInvigilators(sessionId, { all: true });
  const conflictsMutation = useCheckExamSessionConflicts(sessionId);
  const startMutation = useStartExamSession(sessionId);
  const completeMutation = useCompleteExamSession(sessionId);

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  // Newest request first — drives the banner and whether "Request Suspension" is still available.
  const latestSuspension = useSuspensionRequests({ examSessionId: sessionId, limit: 1 }).data?.items[0];
  const suspensionPending = latestSuspension?.status === 'PENDING';
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
  // `POST .../start` and `.../complete` were left ADMIN-only when the
  // faculty-lifecycle-ownership change first landed (attendance.controller.ts
  // predates it and wasn't in that change's own enumerated endpoint list) —
  // a real gap since ADMIN lost write access to every OTHER lifecycle
  // action, leaving a session permanently stuck at READY_FOR_FINALIZATION
  // for everyone. Fixed on the backend to FACULTY-only + ownership-scoped,
  // matching every other action here; mirrored with `!readOnly` below.
  const canStart = !readOnly && session.status === 'READY_FOR_FINALIZATION';
  const canComplete = !readOnly && session.status === 'IN_PROGRESS';

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
            {!readOnly && canReschedule && (
              <Button variant="secondary" onClick={() => setRescheduleOpen(true)}>
                Reschedule
              </Button>
            )}
            {!readOnly && canCancel && (
              <Button variant="destructive" onClick={() => setSuspendOpen(true)} disabled={suspensionPending}>
                {suspensionPending ? 'Suspension Requested' : 'Request Suspension'}
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
              {formatTimeRange(session.startTime, session.endTime)}
            </dd>
          </div>
        </dl>
      </Card>

      <SuspensionStatusBanner request={latestSuspension} isAdmin={readOnly} />

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
        <SessionStatusProgress
          status={session.status}
          invigilatorCount={invigilatorsForProgress.data?.items.length}
          seatingReady={session.seatingReady}
        />
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
        <QuizAttachPanel session={session} readOnly={readOnly} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Roster</h2>} padding="dense">
        <RosterPanel session={session} readOnly={readOnly} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Rooms</h2>} padding="dense">
        <div className="flex flex-col gap-3">
          {readOnly ? <RoomApprovalPanel session={session} /> : <RoomRequestPanel session={session} readOnly={readOnly} />}
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

      <Card header={<h2 className="text-sm font-semibold text-text">Seating</h2>} padding="dense">
        <SeatingPanel session={session} readOnly={readOnly} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Invigilators</h2>} padding="dense">
        <InvigilatorPanel session={session} readOnly={readOnly} />
      </Card>

      <Card header={<h2 className="text-sm font-semibold text-text">Attendance Overview</h2>} padding="dense">
        <AttendanceOverviewPanel session={session} />
      </Card>

      <RescheduleModal open={rescheduleOpen} onOpenChange={setRescheduleOpen} session={session} />
      <SuspensionRequestDialog open={suspendOpen} onOpenChange={setSuspendOpen} sessionId={session.id} sessionName={session.name} />

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
