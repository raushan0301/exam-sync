import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { createRedisConnection } from './redis-connection';
import {
  CRITICAL_QUEUE_NAME,
  NOTIFICATIONS_CRITICAL_QUEUE,
  NOTIFICATIONS_REDIS_CONNECTION,
  NOTIFICATIONS_STANDARD_QUEUE,
  REPORTS_QUEUE,
  REPORTS_QUEUE_NAME,
  STANDARD_QUEUE_NAME,
} from './queue.constants';
import { NotificationRelayService } from './notification-relay.service';
import { QueueShutdownService } from './queue-shutdown.service';

/**
 * BullMQ producer side (ARCHITECTURE.md §AV) — the relay reads `PENDING`/
 * `RETRYING` outbox rows from Postgres and enqueues jobs here; the actual
 * consumer is `workers/notification-worker`, a SEPARATE deployable process
 * (ADR-001's one deliberate exception to "everything ships in the
 * monolith" — see that worker's own Phase-0 skeleton comment), not
 * anything in this module.
 *
 * Global (mirrors PrismaModule/AuditHookModule) so any future module needing
 * direct queue access doesn't need to re-import this.
 */
@Global()
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  providers: [
    {
      // One shared ioredis connection for both Queue instances — BullMQ
      // supports this, and it means exactly one connection to close on
      // shutdown instead of tracking one per queue.
      provide: NOTIFICATIONS_REDIS_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createRedisConnection(requireRedisUrl(config)),
    },
    {
      provide: NOTIFICATIONS_CRITICAL_QUEUE,
      inject: [NOTIFICATIONS_REDIS_CONNECTION],
      useFactory: (connection: ReturnType<typeof createRedisConnection>) =>
        new Queue(CRITICAL_QUEUE_NAME, { connection }),
    },
    {
      provide: NOTIFICATIONS_STANDARD_QUEUE,
      inject: [NOTIFICATIONS_REDIS_CONNECTION],
      useFactory: (connection: ReturnType<typeof createRedisConnection>) =>
        new Queue(STANDARD_QUEUE_NAME, { connection }),
    },
    {
      // Phase 19 — reuses the same shared connection (see
      // `queue.constants.ts`'s own doc comment on why this is a
      // separate queue from the notification lanes).
      provide: REPORTS_QUEUE,
      inject: [NOTIFICATIONS_REDIS_CONNECTION],
      useFactory: (connection: ReturnType<typeof createRedisConnection>) =>
        new Queue(REPORTS_QUEUE_NAME, { connection }),
    },
    NotificationRelayService,
    QueueShutdownService,
  ],
  // NOTIFICATIONS_REDIS_CONNECTION is exported starting Phase 19 —
  // ReportWorkerService (a different module) needs the same shared
  // connection its own BullMQ Worker consumes REPORTS_QUEUE over, rather
  // than opening a redundant second connection to the same Redis.
  exports: [NOTIFICATIONS_CRITICAL_QUEUE, NOTIFICATIONS_STANDARD_QUEUE, REPORTS_QUEUE, NOTIFICATIONS_REDIS_CONNECTION],
})
export class QueueModule {}

function requireRedisUrl(config: ConfigService): string {
  const url = config.get<string>('redis.url');
  if (!url) {
    throw new Error('REDIS_URL is not configured — required for the notification queue (Phase 15).');
  }
  return url;
}
