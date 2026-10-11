/**
 * Framework-independent notification types (Phase 15,
 * IMPLEMENTATION_PLAN.md: outbox/queue/worker/retry/DLQ), mirroring the
 * seating engine's split (Phase 13) between pure `packages/domain-logic`
 * functions and the NestJS-adapter layer in `apps/api`/`workers/*` that
 * calls them.
 */

/** Mirrors `@exam-sync/db`'s `NotificationEventType` enum without importing
 * Prisma into this framework-independent package (same reasoning as
 * `SeatingStrategyName` in seating/types.ts not importing the Prisma enum
 * directly). */
export type NotificationEventTypeName =
  | 'QUIZ_APPROVED'
  | 'QUIZ_REJECTED'
  | 'QUIZ_SUBMITTED'
  | 'SEAT_ASSIGNED'
  | 'EXAM_SESSION_RESCHEDULED'
  | 'EXAM_SESSION_CANCELLED'
  | 'SUSPENSION_REQUESTED'
  | 'SUSPENSION_APPROVED'
  | 'SUSPENSION_REJECTED'
  | 'INVIGILATOR_ASSIGNED'
  | 'INVIGILATOR_REMOVED'
  | 'ROOM_HOLD_RELEASED'
  | 'BACKUP_ROOM_USED'
  | 'ROOM_REQUEST_SUBMITTED'
  | 'ROOM_REQUEST_APPROVED'
  | 'ROOM_REQUEST_REJECTED'
  | 'INCIDENT_STATUS_UPDATED'
  | 'REPORT_READY';

export interface RenderedMessage {
  title: string;
  body: string;
}

/** Result of one delivery-attempt outcome being applied to a notification
 * row's retry state (BR-044, ARCHITECTURE.md §AB's exact backoff table). */
export type RetryDecision =
  | { outcome: 'SENT' }
  | { outcome: 'RETRYING'; nextAttemptAt: Date }
  | { outcome: 'DEAD_LETTER' };
