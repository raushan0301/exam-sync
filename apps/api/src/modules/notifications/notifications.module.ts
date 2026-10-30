import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NavCountsService } from './nav-counts.service';

/**
 * NotificationsModule — real implementation (Phase 15,
 * IMPLEMENTATION_PLAN.md). Owns the read side of the `notifications`
 * outbox table (`GET /me/notifications`, `PATCH /me/notifications/{id}/read`
 * per API_CONTRACT.md). The write side (`NotificationsOutboxService`) and
 * dispatch side (`common/queue`, `workers/notification-worker`) are
 * deliberately NOT owned here — they're global/cross-cutting
 * infrastructure every domain module needs, not this module's own
 * resource, mirroring `AuditHookModule`'s split from any one "audit"
 * feature module.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NavCountsService],
})
export class NotificationsModule {}
