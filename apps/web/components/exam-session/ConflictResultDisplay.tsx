import { Alert } from '@/components/ui';
import type { ConflictDetail } from '@/lib/queries/types';

const CONFLICT_LABELS: Record<ConflictDetail['type'], string> = {
  UNAPPROVED_QUIZ: 'Unapproved quiz',
  QUIZ_ALREADY_ATTACHED_ELSEWHERE: 'Quiz attached elsewhere',
  STUDENT_OVERLAP: 'Student schedule overlap',
  ROOM_OVERLAP: 'Room schedule overlap',
  ROOM_UNAVAILABLE: 'Room unavailable',
  FACULTY_OVERLAP: 'Faculty schedule overlap',
};

function ConflictList({ items }: { items: ConflictDetail[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((c, i) => (
        <li key={i} className="text-sm">
          <span className="font-medium">{CONFLICT_LABELS[c.type] ?? c.type}</span>: {c.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Shared hard/warning conflict display — reused by both the explicit
 * "Check Conflicts" action's result AND a reschedule 409's `details`
 * array, per the milestone spec (one component, two call sites). `hard`
 * conflicts block the action that produced them; `warnings` don't.
 */
export function ConflictResultDisplay({ hard, warnings }: { hard: ConflictDetail[]; warnings: ConflictDetail[] }) {
  if (hard.length === 0 && warnings.length === 0) {
    return (
      <Alert color="success" title="No conflicts">
        This session has no hard conflicts or warnings.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {hard.length > 0 && (
        <Alert color="danger" title={`${hard.length} hard conflict${hard.length === 1 ? '' : 's'}`}>
          <ConflictList items={hard} />
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert color="warning" title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}>
          <ConflictList items={warnings} />
        </Alert>
      )}
    </div>
  );
}
