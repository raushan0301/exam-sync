import { Badge, type BadgeColor } from './Badge';

/**
 * Single source of truth mapping every backend status enum value (across
 * Quiz, Exam Session, Incident, Attendance) to a human-readable label and
 * one of the five semantic colors. Every "successfully completed/approved/
 * finalized" state maps to `success`; every blocking/needs-attention state
 * maps to `warning` or `danger`, consistently across domains.
 */
export const STATUS_CONFIG = {
  // Quiz
  DRAFT: { label: 'Draft', color: 'neutral' },
  SUBMITTED: { label: 'Submitted', color: 'info' },
  APPROVED: { label: 'Approved', color: 'success' },
  REJECTED: { label: 'Rejected', color: 'danger' },

  // Exam session
  ASSIGNING_STUDENTS: { label: 'Assigning Students', color: 'info' },
  ROOM_ALLOCATION: { label: 'Room Allocation', color: 'info' },
  SEATING_GENERATION: { label: 'Seating Generation', color: 'info' },
  READY_FOR_FINALIZATION: { label: 'Ready for Finalization', color: 'warning' },
  FINALIZED: { label: 'Finalized', color: 'success' },
  NOTIFIED: { label: 'Notified', color: 'success' },
  IN_PROGRESS: { label: 'In Progress', color: 'info' },
  COMPLETED: { label: 'Completed', color: 'success' },
  CANCELLED: { label: 'Cancelled', color: 'danger' },

  // SeatingPlanStatus — DRAFT/FINALIZED already covered above (shared key
  // names with Quiz/exam-session). VALIDATED/FAILED/SUPERSEDED added here.
  VALIDATED: { label: 'Validated', color: 'info' },
  FAILED: { label: 'Failed', color: 'danger' },
  SUPERSEDED: { label: 'Superseded', color: 'neutral' },

  // Incident
  OPEN: { label: 'Open', color: 'warning' },
  UNDER_REVIEW: { label: 'Under Review', color: 'info' },
  ESCALATED: { label: 'Escalated', color: 'danger' },
  RESOLVED: { label: 'Resolved', color: 'success' },
  DISMISSED: { label: 'Dismissed', color: 'neutral' },

  // IncidentSeverity — shares STATUS_CONFIG per this file's own convention
  // (single source of truth for every backend enum, not just "status"
  // fields) so severity renders via the same <StatusBadge> everywhere.
  LOW: { label: 'Low', color: 'neutral' },
  MEDIUM: { label: 'Medium', color: 'warning' },
  HIGH: { label: 'High', color: 'danger' },
  CRITICAL: { label: 'Critical', color: 'danger' },

  // Attendance
  PRESENT: { label: 'Present', color: 'success' },
  ABSENT: { label: 'Absent', color: 'danger' },
  LATE: { label: 'Late', color: 'warning' },
  EXCUSED: { label: 'Excused', color: 'neutral' },
  MEDICAL: { label: 'Medical', color: 'info' },
  OTHER: { label: 'Other', color: 'neutral' },

  // AcademicStatus (Department/Program/Batch/Student/Faculty) — Subjects'
  // `is_active` boolean is translated to these same string keys at the
  // call site rather than adding separate true/false entries here.
  ACTIVE: { label: 'Active', color: 'success' },
  INACTIVE: { label: 'Inactive', color: 'neutral' },
} as const satisfies Record<string, { label: string; color: BadgeColor }>;

export type StatusValue = keyof typeof STATUS_CONFIG;

export interface StatusBadgeProps {
  status: StatusValue | (string & Record<never, never>);
  className?: string;
}

/** Thin wrapper over Badge consuming STATUS_CONFIG — never pass an ad hoc color. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = (STATUS_CONFIG as Record<string, { label: string; color: BadgeColor }>)[status];
  if (!config) {
    // Unknown status: fail loud-but-safe visually (neutral pill with the raw value)
    // rather than crashing — helps surface a STATUS_CONFIG gap during development.
    return (
      <Badge color="neutral" className={className}>
        {status}
      </Badge>
    );
  }
  return (
    <Badge color={config.color} className={className}>
      {config.label}
    </Badge>
  );
}
