import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientType,
  Prisma,
} from '@exam-sync/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The channels every notification fans out to. FR-041 requires "in-app +
 * email" only — PUSH is pre-sized on the schema/enum (matching
 * ARCHITECTURE.md §AB's channel column) but has no provider wired in
 * Phase 15, so it is deliberately excluded from this fixed fan-out list.
 */
const REQUIRED_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
];

export interface QueueNotificationParams {
  recipientType: NotificationRecipientType;
  /** `users.id` — the same id `AuthenticatedUser.id` carries, so
   * `/me/notifications` can scope with a plain `WHERE recipient_id = actor.id`,
   * never a Student/Faculty-table join. */
  recipientId: string;
  eventType: NotificationEventType;
  /** The id of the entity the event is about (quiz id, exam session id,
   * seating assignment id, ...) — part of the idempotency key (BR-043). */
  entityId: string;
  /** The entity's version/state discriminator at the moment of this event
   * (e.g. a Quiz's optimistic-lock `version`, or the target status a
   * reschedule/cancel moves to) — distinguishes two genuinely different
   * events on the same entity from a redelivery of the same one
   * (ADR-005's "must not collide" implementation-detail note). */
  entityVersion: string | number;
  payload: Record<string, unknown>;
}

/**
 * The transactional-outbox write helper (ARCHITECTURE.md §AB, BR-042,
 * ADR-005) — every module that triggers a notification calls
 * `queue(tx, ...)` with the SAME `Prisma.TransactionClient` it is already
 * using for its own domain-state change, so the outbox row commits
 * atomically with that change. There is no synchronous-send path anywhere
 * in this service (BR-042) — queuing a row here only ever writes PENDING
 * rows; a separate relay + worker pool (see `common/queue/`,
 * `workers/notification-worker`) does the actual dispatch, later,
 * out-of-band.
 *
 * Global (mirrors `AuditHookService`/`PrismaService`) so every domain
 * module can inject it without a module-boundary violation — this is
 * exactly the kind of cross-cutting "every write-path service calls one
 * consistent method" seam `AuditHookService`'s own doc comment describes,
 * applied to notifications instead of audit logging.
 */
@Injectable()
export class NotificationsOutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fans out to one row per required channel, deduplicated by
   * `idempotency_key` (BR-043) — a redelivery of the same logical event
   * (same event_type + channel + recipient + entity + entity_version)
   * never produces a second row. `skipDuplicates` makes this call
   * idempotent at the DB level without the caller needing to catch a
   * unique-constraint error itself.
   */
  async queue(
    tx: Prisma.TransactionClient | PrismaService | undefined,
    params: QueueNotificationParams,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.notification.createMany({
      data: REQUIRED_CHANNELS.map((channel) => ({
        recipientType: params.recipientType,
        recipientId: params.recipientId,
        eventType: params.eventType,
        channel,
        payload: params.payload as Prisma.InputJsonValue,
        idempotencyKey: buildIdempotencyKey({
          eventType: params.eventType,
          channel,
          recipientType: params.recipientType,
          recipientId: params.recipientId,
          entityId: params.entityId,
          entityVersion: params.entityVersion,
        }),
      })),
      skipDuplicates: true,
    });
  }
}

function buildIdempotencyKey(parts: {
  eventType: string;
  channel: string;
  recipientType: string;
  recipientId: string;
  entityId: string;
  entityVersion: string | number;
}): string {
  return [
    parts.eventType,
    parts.channel,
    parts.recipientType,
    parts.recipientId,
    parts.entityId,
    parts.entityVersion,
  ].join(':');
}
