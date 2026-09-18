import type { IncidentAction, IncidentStatus } from './queries/types';

/**
 * Pure encoding of the incident status-transition graph, verified
 * verbatim against the real service's own transition constants:
 *
 *  - INVESTIGATE: OPEN | ESCALATED -> UNDER_REVIEW
 *  - ESCALATE:    UNDER_REVIEW     -> ESCALATED
 *  - RESOLVE:     UNDER_REVIEW     -> RESOLVED
 *  - DISMISS:     UNDER_REVIEW     -> DISMISSED
 *
 * RESOLVED and DISMISSED are terminal (EC-031) — no action is ever
 * available from either. Used both to render only valid action buttons
 * and (implicitly) as the frontend's own copy of the backend's 409
 * "not a valid transition" rule, so the UI never offers a transition the
 * server would reject.
 */
const TRANSITIONS: Record<IncidentStatus, IncidentAction[]> = {
  OPEN: ['INVESTIGATE'],
  UNDER_REVIEW: ['ESCALATE', 'RESOLVE', 'DISMISS'],
  ESCALATED: ['INVESTIGATE'],
  RESOLVED: [],
  DISMISSED: [],
};

/** Which IncidentAction values are valid to invoke from a given current status. */
export function getAvailableActionsForStatus(status: IncidentStatus): IncidentAction[] {
  return TRANSITIONS[status] ?? [];
}

/** RESOLVE/DISMISS require a non-empty `resolution` (422 otherwise) — always show that field proactively for these. */
export function actionRequiresResolution(action: IncidentAction): boolean {
  return action === 'RESOLVE' || action === 'DISMISS';
}

export const INCIDENT_ACTION_LABELS: Record<IncidentAction, string> = {
  INVESTIGATE: 'Investigate',
  ESCALATE: 'Escalate',
  RESOLVE: 'Resolve',
  DISMISS: 'Dismiss',
};
