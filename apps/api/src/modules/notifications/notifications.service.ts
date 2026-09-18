import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationChannel } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';

export interface ListMyNotificationsParams {
  cursor?: string;
  limit?: number;
}

/**
 * `GET /me/notifications` / `PATCH /me/notifications/{id}/read`
 * (API_CONTRACT.md "Notifications" — both self-scoped). Owns the read
 * side of the `notifications` outbox table; the write side lives in
 * `common/notifications-outbox` (producers) and `workers/notification-worker`
 * (delivery) — this service never writes a PENDING row itself.
 *
 * Self-scoping is a plain `WHERE recipient_id = actor.id` rather than
 * `ScopedRepository` (BR-045) — `recipient_id` IS the `users.id`
 * (`NotificationsOutboxService`'s own doc comment), so there is no
 * separate ownership lookup to perform; the 404-not-403 IDOR posture
 * (ADR-008) still holds because a row belonging to a different user simply
 * never matches the WHERE clause, the same observable outcome as
 * `ScopedRepository.findScoped` would produce.
 *
 * Only `IN_APP` rows are ever shown — `EMAIL` rows in this table are
 * provider deliveries, not inbox entries (EC-025: "in-app notification
 * still shows regardless of email/push provider status" is exactly this
 * distinction: the in-app row's own status, not the email row's, is what
 * the student/faculty actually sees).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(
    actor: AuthenticatedUser,
    params: ListMyNotificationsParams,
  ): Promise<PaginatedResult<Notification>> {
    const limit = resolveLimit(params.limit);
    const rows = await this.prisma.notification.findMany({
      where: { recipientId: actor.id, channel: NotificationChannel.IN_APP },
      orderBy: { createdAt: 'desc' },
      ...cursorFindManyArgs(params.cursor, limit),
    });
    return toPaginatedResult(rows, limit);
  }

  /**
   * Idempotent — marking an already-read notification as read again is a
   * no-op success, not an error (consistent with this system's general
   * "retryable POST/PATCH" idempotency posture, BR-050).
   */
  async markRead(id: string, actor: AuthenticatedUser): Promise<Notification> {
    const existing = await this.prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.recipientId !== actor.id) {
      throw new NotFoundException();
    }
    if (existing.readAt) {
      return existing;
    }
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
