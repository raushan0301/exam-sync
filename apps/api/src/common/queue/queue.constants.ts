import { CRITICAL_QUEUE_NAME, STANDARD_QUEUE_NAME, queueNameForEventType } from '@exam-sync/domain-logic';
import { NotificationEventType } from '@exam-sync/db';

/**
 * Priority lanes (ARCHITECTURE.md §AN, ADR-005's Implementation Notes:
 * "implemented as separate queue topics/streams consumed by
 * differently-provisioned worker pools, not as a priority field within
 * one queue"). The lane names/routing rule live in
 * `@exam-sync/domain-logic` (`notifications/queue-lanes.ts`) since both
 * this process (producer) and `workers/notification-worker` (consumer)
 * must agree on the exact queue name strings.
 */
export { CRITICAL_QUEUE_NAME, STANDARD_QUEUE_NAME };

export const NOTIFICATIONS_CRITICAL_QUEUE = 'NOTIFICATIONS_CRITICAL_QUEUE';
export const NOTIFICATIONS_STANDARD_QUEUE = 'NOTIFICATIONS_STANDARD_QUEUE';
export const NOTIFICATIONS_REDIS_CONNECTION = 'NOTIFICATIONS_REDIS_CONNECTION';

export function queueNameFor(eventType: NotificationEventType): string {
  return queueNameForEventType(eventType as never);
}

/**
 * Phase 19 — a dedicated queue for async report generation, reusing this
 * module's shared Redis connection (IMPLEMENTATION_PLAN.md's own stated
 * dependency: "Phase 15: async job pattern reused"). Deliberately
 * separate from the notification lanes above — report generation
 * (querying + CSV/XLSX formatting) is a functionally distinct kind of
 * job with its own worker, not a notification delivery.
 */
export const REPORTS_QUEUE_NAME = 'reports';
export const REPORTS_QUEUE = 'REPORTS_QUEUE';
