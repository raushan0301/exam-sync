'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Alert, SkeletonText, ErrorState, EmptyState, StatusBadge } from '@/components/ui';
import { SeatMap } from '@/components/seating/SeatMap';
import { AttendanceQuickMarkPanel } from '@/components/exam-session/AttendanceQuickMarkPanel';
import { useExamSession } from '@/lib/queries/useExamSession';
import { useSeatingPlan } from '@/lib/queries/useSeatingPlan';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { useSessionAttendance } from '@/lib/queries/useSessionAttendance';
import { useMarkAttendance, useUpdateAttendance } from '@/lib/mutations/useAttendanceMutations';
import { apiFetch } from '@/lib/api-client';
import { mapError } from '@/lib/error-mapping';
import type { Attendance, AttendanceStatus, ExamSessionRoom, SeatingAssignment, SeatingGenerationSummary } from '@/lib/queries/types';

/**
 * FACULTY attendance-marking page — the invigilator physically in the
 * room, per FRONTEND_UX_ARCHITECTURE.md §8/§12. Reached from a specific
 * session id — linked directly from each row of "My Invigilation Duties"
 * (`app/faculty/invigilation-duties/page.tsx`).
 *
 * Gate: `useExamSession` reuses M6's scoped GET /exam-sessions/{id} —
 * `ExamSessionsAccessRepository` grants a FACULTY caller access if they
 * own an actively-attached quiz OR are assigned as an invigilator on the
 * session (added specifically so this page is reachable by the
 * invigilator, not just the session's creator); the attendance-mark
 * action itself additionally requires invigilator-of-record for the
 * specific room (403/404 from the backend if not — surfaced inline below).
 *
 * Seating-plan discovery: there is still no `GET /exam-sessions/{id}/seating`
 * list endpoint, so each room's plan id is recovered the same way
 * `SeatingPanel` recovers it after a reload: `POST .../seating/generate`
 * is idempotent (EC-032) — since this page only ever runs once the
 * session is IN_PROGRESS (long past SEATING_GENERATION), this probe can
 * only ever return an already-existing plan or 409, never create one.
 */
export default function FacultyAttendanceMarkingPage() {
  const params = useParams<{ id: string }>();
  const sessionQuery = useExamSession(params.id);

  if (sessionQuery.isLoading) {
    return (
      <Card>
        <SkeletonText lines={6} />
      </Card>
    );
  }
  if (sessionQuery.isError) {
    const mapped = mapError(sessionQuery.error);
    return <ErrorState title={mapped.title} description={mapped.description} onRetry={() => sessionQuery.refetch()} />;
  }

  const session = sessionQuery.data;
  if (!session) return null;

  if (session.status !== 'IN_PROGRESS') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-text">{session.name} — Attendance</h1>
        <Card>
          <EmptyState
            title="Attendance marking is not available yet"
            description={
              session.status === 'COMPLETED'
                ? 'This exam session has already completed. Its attendance records are read-only here — view them from the admin overview.'
                : `This exam session is in status "${session.status}". Attendance marking will be available once the session starts (status IN_PROGRESS).`
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{session.name} — Attendance</h1>
        <StatusBadge status={session.status} />
      </div>
      {session.rooms.length === 0 ? (
        <EmptyState title="No rooms allocated" description="This session has no allocated rooms yet." />
      ) : (
        session.rooms.map((room) => <RoomAttendanceCard key={room.id} examSessionId={session.id} room={room} />)
      )}
    </div>
  );
}

function RoomAttendanceCard({ examSessionId, room }: { examSessionId: string; room: ExamSessionRoom }) {
  const [planId, setPlanId] = useState<string | undefined>(undefined);
  const [probeError, setProbeError] = useState<string | null>(null);
  // Only used for a LOCKED record (BR-035 needs a reason before it can
  // change) — the common, unlocked case toggles Present/Absent directly
  // on click, no panel involved (see `onSeatToggle` below).
  const [activeSeat, setActiveSeat] = useState<{ assignment: SeatingAssignment; attendance: Attendance | undefined } | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  // Display-only optimistic status per seat, set the instant a seat is
  // clicked so the color/tooltip update immediately instead of waiting on
  // the mutation round trip plus the subsequent query refetch — see
  // SeatMap's own `attendanceOverrideBySeatId` doc comment. Reconciled
  // away below once the real (refetched) data agrees with it; reverted
  // immediately on a failed mutation.
  const [optimisticStatusBySeatId, setOptimisticStatusBySeatId] = useState<Map<string, AttendanceStatus>>(new Map());
  const markMutation = useMarkAttendance(examSessionId);
  const updateMutation = useUpdateAttendance(examSessionId);

  // Recovers this room's seating-plan id without a list endpoint — see
  // this file's own header comment for why this probe can never create a
  // new plan here (the session is always IN_PROGRESS by this point).
  useEffect(() => {
    if (planId) return;
    let cancelled = false;
    apiFetch<SeatingGenerationSummary>(`/exam-sessions/${examSessionId}/seating/generate`, {
      method: 'POST',
      body: { room_id: room.id, strategy: 'SEQUENTIAL' },
    })
      .then((result) => {
        if (!cancelled) setPlanId(result.seating_plan_id);
      })
      .catch((err) => {
        if (!cancelled) setProbeError(mapError(err).description);
      });
    return () => {
      cancelled = true;
    };
  }, [planId, examSessionId, room.id]);

  const planQuery = useSeatingPlan(planId);
  const seatsQuery = useRoomSeats(planId ? room.id : undefined);
  const attendanceQuery = useSessionAttendance(examSessionId, { limit: 200 });

  const attendanceBySeatId = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const a of attendanceQuery.data?.items ?? []) map.set(a.seatId, a);
    return map;
  }, [attendanceQuery.data]);

  // Once the refetched real data agrees with an optimistic guess, drop
  // it — the real map is now the source of truth for that seat again.
  useEffect(() => {
    if (optimisticStatusBySeatId.size === 0) return;
    setOptimisticStatusBySeatId((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [seatId, status] of prev) {
        if (attendanceBySeatId.get(seatId)?.status === status) {
          next.delete(seatId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [attendanceBySeatId, optimisticStatusBySeatId]);

  const assignments = planQuery.data?.assignments ?? [];
  const markedCount = assignments.filter((a) => attendanceBySeatId.has(a.seatId) || optimisticStatusBySeatId.has(a.seatId)).length;

  return (
    <Card
      header={
        <h3 className="text-sm font-semibold text-text">
          {room.building} · Floor {room.floor} · Room {room.roomNumber}
        </h3>
      }
      padding="dense"
    >
      <div className="flex flex-col gap-3">
        {!planId && !probeError && <SkeletonText lines={4} />}

        {!planId && probeError && (
          <ErrorState title="Couldn't find a seating plan for this room" description={probeError} />
        )}

        {planId && planQuery.isLoading && <SkeletonText lines={4} />}
        {planId && planQuery.isError && (
          <ErrorState
            title="Couldn't load this seating plan"
            description={mapError(planQuery.error).description}
            onRetry={() => planQuery.refetch()}
          />
        )}

        {planId && planQuery.data && planQuery.data.status !== 'FINALIZED' && (
          <Alert color="warning" title="This plan isn't finalized">
            Attendance can only be marked against a FINALIZED seating plan (status is currently {planQuery.data.status}).
          </Alert>
        )}

        {planId && planQuery.data?.status === 'FINALIZED' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              {markedCount} of {assignments.length} marked
            </p>
            {toggleError && (
              <Alert color="danger" title="Couldn't record attendance">
                {toggleError}
              </Alert>
            )}
            {seatsQuery.isLoading ? (
              <SkeletonText lines={4} />
            ) : (
              <SeatMap
                seats={seatsQuery.data ?? []}
                assignments={assignments}
                coloring="attendance"
                attendanceBySeatId={attendanceBySeatId}
                attendanceOverrideBySeatId={optimisticStatusBySeatId}
                onAttendanceSeatClick={(assignment, attendance) => {
                  setToggleError(null);
                  // A locked record (session already completed, an
                  // after-the-fact correction) needs a reason before it can
                  // change (BR-035) — that still goes through the panel
                  // below. Otherwise, toggle Present/Absent immediately:
                  // this IS the interaction, no confirm step.
                  if (attendance?.locked) {
                    setActiveSeat({ assignment, attendance });
                    return;
                  }
                  const nextStatus: AttendanceStatus = attendance?.status === 'PRESENT' ? 'ABSENT' : 'PRESENT';
                  setOptimisticStatusBySeatId((prev) => new Map(prev).set(assignment.seatId, nextStatus));
                  const promise = attendance
                    ? updateMutation.mutateAsync({ attendanceId: attendance.id, status: nextStatus })
                    : markMutation.mutateAsync({ student_id: assignment.student.id, status: nextStatus, method: 'SEAT_BASED' });
                  promise.catch((err) => {
                    setToggleError(mapError(err).description);
                    // Revert the optimistic guess — the mutation never went through.
                    setOptimisticStatusBySeatId((prev) => {
                      const next = new Map(prev);
                      next.delete(assignment.seatId);
                      return next;
                    });
                  });
                }}
              />
            )}
            {activeSeat && (
              <AttendanceQuickMarkPanel
                examSessionId={examSessionId}
                assignment={activeSeat.assignment}
                attendance={activeSeat.attendance}
                onClose={() => setActiveSeat(null)}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
