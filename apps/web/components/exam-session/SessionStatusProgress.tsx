import { cn } from '@/components/ui';
import type { ExamSessionStatus } from '@/lib/queries/types';

/**
 * The normal forward path a session takes (CANCELLED is a separate
 * terminal state reachable from most of these, not a step in this list —
 * rendered as its own banner instead, see below). Purely a plain,
 * non-interactive ordered indicator: no phase here has a frontend action
 * beyond what M6 actually builds (create, quiz attach/detach, reschedule,
 * cancel, conflict check) — everything from ASSIGNING_STUDENTS onward has
 * no corresponding UI action yet (those live in later phases/modules per
 * exam-sessions.service.ts's own header comment), so this is a status
 * readout only, never a set of fake buttons.
 */
const PROGRESSION: { status: ExamSessionStatus; label: string }[] = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'ASSIGNING_STUDENTS', label: 'Assigning Students' },
  { status: 'ROOM_ALLOCATION', label: 'Room Allocation' },
  { status: 'SEATING_GENERATION', label: 'Seating Generation' },
  { status: 'READY_FOR_FINALIZATION', label: 'Ready for Finalization' },
  { status: 'FINALIZED', label: 'Finalized' },
  { status: 'NOTIFIED', label: 'Notified' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'COMPLETED', label: 'Completed' },
];

export function SessionStatusProgress({ status }: { status: ExamSessionStatus }) {
  if (status === 'CANCELLED') {
    return <p className="text-sm text-danger-text">This exam session was cancelled.</p>;
  }

  const currentIndex = PROGRESSION.findIndex((p) => p.status === status);

  return (
    <ol className="flex flex-col gap-2">
      {PROGRESSION.map((step, i) => {
        const done = currentIndex >= 0 && i < currentIndex;
        const current = i === currentIndex;
        return (
          <li key={step.status} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs',
                done && 'bg-success-bg text-success-text',
                current && 'bg-info-bg text-info-text font-semibold',
                !done && !current && 'bg-neutral-100 text-text-subtle',
              )}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className={cn(current ? 'font-medium text-text' : 'text-text-muted')}>{step.label}</span>
            {current && <span className="text-xs text-text-subtle">(current)</span>}
          </li>
        );
      })}
    </ol>
  );
}
