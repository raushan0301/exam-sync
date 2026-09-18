import { NotificationEventTypeName } from './types';

/**
 * BullMQ queue names shared verbatim between the producer (`apps/api`'s
 * relay, `common/queue/`) and the consumer (`workers/notification-worker`)
 * — two separate deployable processes that must agree on the exact string
 * or jobs enqueued by one are never seen by the other. Living here (the
 * one package both already depend on) instead of being duplicated in each
 * is the same reasoning as this package's other framework-independent
 * cross-process contracts.
 */
export const CRITICAL_QUEUE_NAME = 'notifications-critical';
export const STANDARD_QUEUE_NAME = 'notifications-standard';

/**
 * `INCIDENT_STATUS_UPDATED` has no producer yet (Incidents is Phase 18) —
 * see `apps/api/src/common/queue/queue.constants.ts`'s fuller comment on
 * why event-type-level routing is a coarse stand-in for BR-038's actual
 * severity-based rule, to be refined once a real payload shape exists.
 */
const CRITICAL_EVENT_TYPES: NotificationEventTypeName[] = [
  'EXAM_SESSION_CANCELLED',
  'INCIDENT_STATUS_UPDATED',
];

export function queueNameForEventType(eventType: NotificationEventTypeName): string {
  return CRITICAL_EVENT_TYPES.includes(eventType) ? CRITICAL_QUEUE_NAME : STANDARD_QUEUE_NAME;
}
