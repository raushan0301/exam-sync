import { cn } from '@/components/ui';
import type { ExamSessionStatus } from '@/lib/queries/types';

/**
 * The normal forward path a session takes (CANCELLED is a separate
 * terminal state reachable from most of these, not a step in this list —
 * rendered as its own banner instead, see below). This is the "visual
 * progress stepper" added for the faculty-lifecycle-ownership change —
 * these 9 steps are the real `ExamSessionStatus` Prisma enum values
 * (packages/db/prisma/schema.prisma), in their declared order, and they
 * happen to match the 9 stage names given for that change 1:1 (Draft →
 * Assigning Students → Room Allocation → Seating Generation → Ready for
 * Finalization → Finalized → Notified → In Progress → Completed) — no
 * invented/renamed statuses here. Still a pure status readout, never a
 * set of clickable steps: no phase here has ever had a "jump to this
 * step" action, faculty-driven or otherwise.
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

interface DisplayStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

export interface SessionStatusProgressProps {
  status: ExamSessionStatus;
  /**
   * Not a real `ExamSessionStatus` value — invigilator assignment has no
   * dedicated status of its own in the Prisma enum (it can happen any time
   * from Room Allocation onward), so it's inserted into the displayed
   * sequence purely for visual placement, right after Seating Generation.
   * Its own `done`/`current` are derived from whether any invigilator is
   * assigned yet, not from `currentIndex` — it never gates or reorders the
   * real status steps around it.
   */
  invigilatorCount?: number;
  /**
   * True once every allocated room already has a VALIDATED/FINALIZED
   * seating plan (`ExamSessionsService.getDetail`'s own field). The real
   * `SEATING_GENERATION` status covers BOTH "still generating/validating
   * plans" and "plans are done, just waiting on an invigilator" — without
   * this, the stepper looks stuck on "Seating Generation" even right
   * after a plan is finalized, since the backend correctly won't advance
   * the enum until an invigilator is assigned too (see
   * `ExamSessionsService.maybeAdvanceToReadyForFinalization`). When true
   * and no invigilator is assigned yet, "Seating Generation" is shown
   * done and "Assign Invigilator" becomes the current step instead.
   */
  seatingReady?: boolean;
}

export function SessionStatusProgress({ status, invigilatorCount, seatingReady }: SessionStatusProgressProps) {
  if (status === 'CANCELLED') {
    return <p className="text-sm text-danger-text">This exam session was cancelled.</p>;
  }

  const currentIndex = PROGRESSION.findIndex((p) => p.status === status);
  const hasInvigilator = (invigilatorCount ?? 0) > 0;
  // Seating is functionally complete but the enum hasn't (and, per the
  // invigilator gate, correctly can't) advance yet — treat "Seating
  // Generation" as done and shift "current" onto "Assign Invigilator".
  const waitingOnInvigilatorOnly = status === 'SEATING_GENERATION' && !!seatingReady && !hasInvigilator;

  const steps: DisplayStep[] = PROGRESSION.map((step, i) => ({
    key: step.status,
    label: step.label,
    done: (currentIndex >= 0 && i < currentIndex) || (step.status === 'SEATING_GENERATION' && waitingOnInvigilatorOnly),
    current: i === currentIndex && !waitingOnInvigilatorOnly,
  }));
  const seatingGenerationIndex = steps.findIndex((s) => s.key === 'SEATING_GENERATION');
  steps.splice(seatingGenerationIndex + 1, 0, {
    key: 'INVIGILATION',
    label: 'Assign Invigilator',
    done: hasInvigilator,
    current: waitingOnInvigilatorOnly,
  });

  return (
    <ol
      className="flex flex-wrap items-start gap-y-4 overflow-x-auto sm:flex-nowrap"
      aria-label="Exam session progress"
    >
      {steps.map((step, i) => {
        const { done, current } = step;
        const isLast = i === steps.length - 1;
        return (
          <li key={step.key} className="flex min-w-[92px] flex-1 flex-col items-center gap-1.5 text-center sm:min-w-0">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs transition-colors',
                  done && 'bg-success-bg text-success-text',
                  current && 'bg-info-bg text-info-text font-semibold ring-2 ring-info-text/30',
                  !done && !current && 'bg-neutral-100 text-text-subtle',
                )}
                aria-hidden="true"
              >
                {done ? '✓' : i + 1}
              </span>
              {!isLast && (
                <span
                  className={cn('h-0.5 flex-1', done ? 'bg-success-bg' : 'bg-neutral-100')}
                  aria-hidden="true"
                />
              )}
            </div>
            <span className={cn('text-xs leading-tight', current ? 'font-medium text-text' : 'text-text-muted')}>
              {step.label}
            </span>
            {current && <span className="text-[10px] text-text-subtle">(current)</span>}
          </li>
        );
      })}
    </ol>
  );
}
