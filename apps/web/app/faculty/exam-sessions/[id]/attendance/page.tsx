'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Alert, Input, Button, SkeletonText, ErrorState, EmptyState, StatusBadge } from '@/components/ui';
import { SeatMap } from '@/components/seating/SeatMap';
import { AttendanceQuickMarkPanel } from '@/components/exam-session/AttendanceQuickMarkPanel';
import { useExamSession } from '@/lib/queries/useExamSession';
import { useSeatingPlan } from '@/lib/queries/useSeatingPlan';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { useSessionAttendance } from '@/lib/queries/useSessionAttendance';
import { mapError } from '@/lib/error-mapping';
import type { Attendance, ExamSessionRoom, SeatingAssignment } from '@/lib/queries/types';

/**
 * FACULTY attendance-marking page — the invigilator physically in the
 * room, per FRONTEND_UX_ARCHITECTURE.md §8/§12. Reached from a specific
 * session id (there is no session-list endpoint for FACULTY — the
 * intended discovery path is each row of "My Invigilation Duties" linking
 * here, but that list is itself blocked by the self-ID-resolution gap
 * documented on `app/faculty/invigilation-duties/page.tsx`; until that
 * gap is closed, this page is reachable only via a direct link, e.g. one
 * an admin shares).
 *
 * Gate: `useExamSession` reuses M6's scoped GET /exam-sessions/{id} — a
 * FACULTY caller only sees a session it owns at least one quiz in
 * (exam-sessions-access.repository.ts); the attendance-mark action itself
 * additionally requires invigilator-of-record for the specific room
 * (403/404 from the backend if not — surfaced inline below, not
 * pre-checked client-side since there's no endpoint to check it against
 * ahead of time).
 *
 * Seating-plan discovery: there is no `GET /exam-sessions/{id}/seating`
 * (or any per-room) list endpoint on the real backend — confirmed by
 * reading `SeatingEngineController` — so a room's seating-plan id is not
 * otherwise obtainable here. The admin hub's Seating panel shows it
 * (visible once a plan is generated there); this page asks for it
 * directly rather than pretending a lookup exists.
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
  const [planId, setPlanId] = useState('');
  const [submittedPlanId, setSubmittedPlanId] = useState<string | undefined>(undefined);
  const [activeSeat, setActiveSeat] = useState<{ assignment: SeatingAssignment; attendance: Attendance | undefined } | null>(null);

  const planQuery = useSeatingPlan(submittedPlanId);
  const seatsQuery = useRoomSeats(submittedPlanId ? room.id : undefined);
  const attendanceQuery = useSessionAttendance(examSessionId, { limit: 200 });

  const attendanceBySeatId = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const a of attendanceQuery.data?.items ?? []) map.set(a.seatId, a);
    return map;
  }, [attendanceQuery.data]);

  const assignments = planQuery.data?.assignments ?? [];
  const markedCount = assignments.filter((a) => attendanceBySeatId.has(a.seatId)).length;

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
        {!submittedPlanId && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmittedPlanId(planId.trim() || undefined);
            }}
          >
            <Input
              label="Seating Plan ID"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              placeholder="Paste this room's finalized seating plan id"
            />
            <Button type="submit" disabled={!planId.trim()}>
              Load Seat Map
            </Button>
          </form>
        )}

        {submittedPlanId && planQuery.isLoading && <SkeletonText lines={4} />}
        {submittedPlanId && planQuery.isError && (
          <ErrorState
            title="Couldn't load this seating plan"
            description={mapError(planQuery.error).description}
            onRetry={() => planQuery.refetch()}
          />
        )}

        {submittedPlanId && planQuery.data && planQuery.data.status !== 'FINALIZED' && (
          <Alert color="warning" title="This plan isn't finalized">
            Attendance can only be marked against a FINALIZED seating plan (status is currently {planQuery.data.status}).
          </Alert>
        )}

        {submittedPlanId && planQuery.data?.status === 'FINALIZED' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              {markedCount} of {assignments.length} marked
            </p>
            {seatsQuery.isLoading ? (
              <SkeletonText lines={4} />
            ) : (
              <SeatMap
                seats={seatsQuery.data ?? []}
                assignments={assignments}
                coloring="attendance"
                attendanceBySeatId={attendanceBySeatId}
                onAttendanceSeatClick={(assignment, attendance) => setActiveSeat({ assignment, attendance })}
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
