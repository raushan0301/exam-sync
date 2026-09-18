'use client';

import { useState } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { useMarkAttendance, useUpdateAttendance } from '@/lib/mutations/useAttendanceMutations';
import { mapError } from '@/lib/error-mapping';
import type { Attendance, AttendanceStatus, SeatingAssignment } from '@/lib/queries/types';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
  { value: 'EXCUSED', label: 'Excused' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'OTHER', label: 'Other' },
];

export interface AttendanceQuickMarkPanelProps {
  examSessionId: string;
  assignment: SeatingAssignment;
  attendance: Attendance | undefined;
  onClose: () => void;
}

/**
 * The single most important mobile interaction in this milestone
 * (FRONTEND_UX_ARCHITECTURE.md §8/§12): "attendance marking IS clicking a
 * seat, not filling a separate form." Large (≥44px) status buttons, no
 * dropdown. First mark uses `useMarkAttendance` (method: SEAT_BASED, since
 * this is driven entirely by a seat-map click); a re-mark of an existing
 * record uses `useUpdateAttendance`, which proactively shows the reason
 * field once `attendance.locked` is true rather than waiting for the 423
 * round trip (same "require it client-side once you know" convention
 * BR-035 calls for here, mirroring M5/M7's reason-required precedent).
 */
export function AttendanceQuickMarkPanel({ examSessionId, assignment, attendance, onClose }: AttendanceQuickMarkPanelProps) {
  const [reason, setReason] = useState('');
  const markMutation = useMarkAttendance(examSessionId);
  const updateMutation = useUpdateAttendance(examSessionId);

  const isLocked = attendance?.locked ?? false;
  const pending = markMutation.isPending || updateMutation.isPending;
  const error = markMutation.error ?? updateMutation.error;
  const mapped = error ? mapError(error) : undefined;
  // BR-035: a reason is only actually required once the record is locked
  // AND the chosen status differs from what's already recorded — a no-op
  // resubmission of the current status needs no reason.
  const requiresReason = isLocked;

  async function onPick(status: AttendanceStatus) {
    try {
      if (!attendance) {
        await markMutation.mutateAsync({ student_id: assignment.student.id, status, method: 'SEAT_BASED' });
      } else {
        if (status === attendance.status) {
          onClose();
          return;
        }
        if (requiresReason && reason.trim().length === 0) {
          // Surfaced inline below without calling the mutation — the 423 is
          // still the real server-side backstop, this just avoids a wasted
          // round trip once the client already knows the record is locked.
          return;
        }
        await updateMutation.mutateAsync({ attendanceId: attendance.id, status, reason: requiresReason ? reason : undefined });
      }
      onClose();
    } catch {
      // surfaced below via mark/update mutation .error, panel stays open
    }
  }

  return (
    <div role="dialog" aria-label={`Mark attendance for ${assignment.student.name}`} className="flex w-full max-w-sm flex-col gap-3 rounded border border-border bg-surface p-4 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-text">{assignment.student.name}</p>
          <p className="text-xs text-text-muted">{assignment.quiz.title}</p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-text-muted hover:text-text" aria-label="Close">
          Close
        </button>
      </div>

      {isLocked && (
        <Alert color="warning" title="This record is locked">
          The exam session has completed. Changing this status requires a reason.
        </Alert>
      )}

      {mapped && (
        <Alert color="danger" title="Couldn't record attendance">
          {mapped.description}
        </Alert>
      )}

      {requiresReason && (
        <Input
          label="Reason for change (required — record is locked)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Corrected after review"
        />
      )}
      {requiresReason && reason.trim().length === 0 && (
        <p className="text-xs text-danger-text">A reason is required to change a locked record (BR-035).</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={attendance?.status === opt.value ? 'primary' : 'secondary'}
            className="min-h-[44px]"
            onClick={() => onPick(opt.value)}
            disabled={pending || (requiresReason && reason.trim().length === 0 && opt.value !== attendance?.status)}
            loading={pending}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
