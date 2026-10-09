'use client';

import { useMemo, useState } from 'react';
import type { Attendance, AttendanceStatus, SeatingAssignment } from '@/lib/queries/types';

export interface SeatMapProps {
  /** Every seat in the room (active + inactive) — from `useRoomSeats`, same shape `app/admin/rooms/[id]` already renders. */
  seats: { id: string; rowIndex: number; colIndex: number; seatLabel: string; isActive: boolean; isAccessible: boolean }[];
  /** Occupied seats for this plan, each carrying its student + quiz join. */
  assignments: SeatingAssignment[];
  /**
   * How to color occupied seats. `'subject'` (default) colors by quiz —
   * the M8 read-only mode. `'attendance'` (M9) colors by
   * `AttendanceStatus` instead and makes occupied seats CLICKABLE via
   * `onAttendanceSeatClick`. `'incident'` also colors by subject (same
   * palette as `'subject'`) but makes occupied seats clickable via
   * `onIncidentSeatClick`, and highlights `selectedSeatId` distinctly —
   * used by the incident-report form's "pick the seat/student" picker.
   */
  coloring?: 'subject' | 'attendance' | 'incident';
  /** `coloring="incident"` only: the currently-picked seat, highlighted distinctly from other occupied seats. */
  selectedSeatId?: string;
  /** `coloring="incident"` only: called when an occupied seat is clicked. Empty seats are not clickable. */
  onIncidentSeatClick?: (assignment: SeatingAssignment) => void;
  /**
   * `coloring="attendance"` only: this quiz/session's attendance rows,
   * keyed by `seatId` (a seat holds at most one active occupant per plan,
   * so this is unambiguous). A seat with an assignment but no entry here
   * is occupied-but-unmarked.
   */
  attendanceBySeatId?: Map<string, Attendance>;
  /**
   * `coloring="attendance"` only: called when an occupied seat is clicked,
   * instead of opening the read-only student/quiz popover. The caller
   * (which owns the mark/update mutations) is responsible for rendering
   * whatever quick-mark UI it wants — this component only reports the
   * click, it never calls a mutation itself.
   */
  onAttendanceSeatClick?: (assignment: SeatingAssignment, attendance: Attendance | undefined) => void;
  /**
   * `coloring="attendance"` only: a display-only status override per
   * seatId, applied ON TOP of `attendanceBySeatId` for color/tooltip
   * purposes — lets the caller show the new status the instant a seat is
   * clicked, instead of waiting on the mark/update round trip and the
   * subsequent query refetch (two network round trips of visible lag
   * otherwise). Deliberately NOT used for the click callback's own
   * `attendance` argument — that still reflects the real record (its
   * `id`/`locked` are what the next mutation call actually needs), so an
   * optimistic entry only ever affects what's painted, never the mutation
   * logic built on top of it.
   */
  attendanceOverrideBySeatId?: Map<string, AttendanceStatus>;
}

const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  PRESENT: '#16a34a', // success
  ABSENT: '#dc2626', // danger
  LATE: '#d97706', // warning
  EXCUSED: '#6b7280', // neutral-ish, distinct from unmarked
  MEDICAL: '#0891b2',
  OTHER: '#9333ea',
};
const UNMARKED_COLOR = '#9ca3af'; // clear "occupied but not yet marked" neutral, distinct from empty (bg-surface)

const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
  MEDICAL: 'Medical',
  OTHER: 'Other',
};

/**
 * Read-only-by-default physical seat grid: reuses the CSS-grid-of-buttons
 * technique from `app/admin/rooms/[id]/page.tsx`'s simple seat toggle.
 * `coloring="subject"` (M8) colors occupied seats by subject and shows a
 * student+quiz popover on click, with NO edit/reassign affordance — see
 * that mode's own note below. `coloring="attendance"` (M9) colors by
 * attendance status and reports seat clicks upward via
 * `onAttendanceSeatClick` so the caller can drive `useMarkAttendance`/
 * `useUpdateAttendance` — there is still no seat REASSIGNMENT here in
 * either mode, since `POST /seating-plans/{id}/swap` does not exist on the
 * backend (the controller's own header comment discloses this as a
 * deliberate deferral); attendance status is a distinct field from seat
 * assignment and marking it never moves a student's seat.
 */
const SELECTED_INCIDENT_COLOR = '#dc2626';

export function SeatMap({
  seats,
  assignments,
  coloring = 'subject',
  attendanceBySeatId,
  onAttendanceSeatClick,
  attendanceOverrideBySeatId,
  selectedSeatId,
  onIncidentSeatClick,
}: SeatMapProps) {
  const [openSeatId, setOpenSeatId] = useState<string | null>(null);

  const assignmentBySeatId = useMemo(() => {
    const map = new Map<string, SeatingAssignment>();
    for (const a of assignments) map.set(a.seatId, a);
    return map;
  }, [assignments]);

  const subjectColors = useMemo(() => {
    const subjectIds = Array.from(new Set(assignments.map((a) => a.quiz.id)));
    const map = new Map<string, string>();
    for (const id of subjectIds) map.set(id, hashToPaletteColor(id));
    return map;
  }, [assignments]);

  const seatsByRow = useMemo(() => {
    const map = new Map<number, typeof seats>();
    for (const seat of seats) {
      const row = map.get(seat.rowIndex) ?? [];
      row.push(seat);
      map.set(seat.rowIndex, row);
    }
    return map;
  }, [seats]);
  const rowIndices = [...seatsByRow.keys()].sort((a, b) => a - b);

  const legendEntries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of assignments) {
      if (!seen.has(a.quiz.id)) seen.set(a.quiz.id, a.quiz.title);
    }
    return [...seen.entries()];
  }, [assignments]);

  const openSeat = openSeatId ? seats.find((s) => s.id === openSeatId) : undefined;
  const openAssignment = openSeatId ? assignmentBySeatId.get(openSeatId) : undefined;

  if (seats.length === 0) {
    return <p className="text-sm text-text-muted">This room has no seats configured.</p>;
  }

  const isAttendanceMode = coloring === 'attendance';
  const isIncidentMode = coloring === 'incident';

  function effectiveStatus(seatId: string): AttendanceStatus | undefined {
    return attendanceOverrideBySeatId?.get(seatId) ?? attendanceBySeatId?.get(seatId)?.status;
  }

  function seatColor(assignment: SeatingAssignment | undefined, seatId: string): string | undefined {
    if (!assignment) return undefined;
    if (isIncidentMode && seatId === selectedSeatId) return SELECTED_INCIDENT_COLOR;
    if (isAttendanceMode) {
      const status = effectiveStatus(seatId);
      return status ? ATTENDANCE_COLORS[status] : UNMARKED_COLOR;
    }
    return subjectColors.get(assignment.quiz.id);
  }

  function seatLabel(assignment: SeatingAssignment | undefined, seatId: string, seatLabelText: string): string {
    if (!assignment) return `Seat ${seatLabelText}, empty`;
    if (isIncidentMode) {
      const selectedText = seatId === selectedSeatId ? ', selected' : '';
      return `Seat ${seatLabelText}, ${assignment.student.name} (${assignment.student.rollNumber})${selectedText}`;
    }
    if (isAttendanceMode) {
      const status = effectiveStatus(seatId);
      const statusText = status ? ATTENDANCE_STATUS_LABELS[status] : 'not yet marked';
      return `Seat ${seatLabelText}, ${assignment.student.name} (${assignment.student.rollNumber}), attendance ${statusText}`;
    }
    return `Seat ${seatLabelText}, occupied by ${assignment.student.name} (${assignment.student.rollNumber}), ${assignment.quiz.title}`;
  }

  function onSeatClick(seatId: string, assignment: SeatingAssignment | undefined) {
    if (!assignment) return;
    if (isIncidentMode) {
      onIncidentSeatClick?.(assignment);
      return;
    }
    if (isAttendanceMode) {
      onAttendanceSeatClick?.(assignment, attendanceBySeatId?.get(seatId));
      return;
    }
    setOpenSeatId(seatId);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 overflow-x-auto">
        {rowIndices.map((rowIdx) => (
          <div key={rowIdx} className="flex gap-1">
            {(seatsByRow.get(rowIdx) ?? [])
              .sort((a, b) => a.colIndex - b.colIndex)
              .map((seat) => {
                // Inactive/nonexistent seats render as a gap, not a colored box.
                if (!seat.isActive) {
                  return <div key={seat.id} className="h-8 w-8 shrink-0" aria-hidden="true" />;
                }
                const assignment = assignmentBySeatId.get(seat.id);
                const color = seatColor(assignment, seat.id);
                // Attendance mode needs real touch targets (mobile, live exam
                // room per FRONTEND_UX_ARCHITECTURE.md §12) — bump from the
                // M8 8x8 (32px) box to a ≥44px hit target; subject mode stays
                // compact since it is desktop-review-only, never a touch flow.
                const sizeClass = isAttendanceMode || isIncidentMode ? 'h-11 w-11 text-xs' : 'h-8 w-8 text-[10px]';
                return (
                  <button
                    key={seat.id}
                    type="button"
                    onClick={() => onSeatClick(seat.id, assignment)}
                    title={assignment ? seatLabel(assignment, seat.id, seat.seatLabel) : seat.seatLabel}
                    aria-label={seatLabel(assignment, seat.id, seat.seatLabel)}
                    className={[
                      'flex shrink-0 items-center justify-center rounded border font-mono',
                      sizeClass,
                      assignment ? 'cursor-pointer text-white' : 'cursor-default border-border bg-surface text-text-muted',
                      seat.isAccessible ? 'ring-2 ring-info' : '',
                    ].join(' ')}
                    style={color ? { backgroundColor: color, borderColor: color } : undefined}
                  >
                    {seat.seatLabel}
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      {isAttendanceMode ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <span className="font-medium text-text">Legend:</span>
          {(['PRESENT', 'ABSENT'] as AttendanceStatus[]).map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: ATTENDANCE_COLORS[status] }} aria-hidden="true" />
              {ATTENDANCE_STATUS_LABELS[status]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: UNMARKED_COLOR }} aria-hidden="true" />
            Not yet marked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-border bg-surface" aria-hidden="true" />
            Empty
          </span>
          <span className="text-text-subtle">Click a seat to toggle Present/Absent — hover for roll no. &amp; name.</span>
        </div>
      ) : isIncidentMode ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <span className="font-medium text-text">Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: SELECTED_INCIDENT_COLOR }} aria-hidden="true" />
            Selected
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-border bg-surface" aria-hidden="true" />
            Empty
          </span>
          <span className="text-text-subtle">Click an occupied seat to attach that student to this report.</span>
        </div>
      ) : (
        legendEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
            <span className="font-medium text-text">Legend:</span>
            {legendEntries.map(([quizId, title]) => (
              <span key={quizId} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: subjectColors.get(quizId) }}
                  aria-hidden="true"
                />
                {title}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border border-border bg-surface" aria-hidden="true" />
              Empty
            </span>
          </div>
        )
      )}

      {!isAttendanceMode && openSeat && openAssignment && (
        <div
          role="dialog"
          aria-label={`Seat ${openSeat.seatLabel} details`}
          className="w-fit rounded border border-border bg-surface p-3 text-sm shadow-sm"
        >
          <div className="mb-1 flex items-center justify-between gap-4">
            <span className="font-medium text-text">Seat {openSeat.seatLabel}</span>
            <button
              type="button"
              onClick={() => setOpenSeatId(null)}
              className="text-xs text-text-muted hover:text-text"
              aria-label="Close"
            >
              Close
            </button>
          </div>
          <dl className="flex flex-col gap-0.5 text-text-muted">
            <div>
              <dt className="inline text-text-muted">Student: </dt>
              <dd className="inline text-text">{openAssignment.student.name}</dd>
            </div>
            <div>
              <dt className="inline text-text-muted">Quiz: </dt>
              <dd className="inline text-text">{openAssignment.quiz.title}</dd>
            </div>
          </dl>
          {/* Deliberately no edit/reassign/swap action here — read-only, see component doc comment. */}
        </div>
      )}
    </div>
  );
}

// Fixed, high-contrast palette (validated for light/dark legibility) —
// deterministic hash-to-index keeps the same quiz always mapped to the
// same color across renders/reloads, not a random hue-per-render.
const PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#9333ea', // purple
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
];

function hashToPaletteColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
}
