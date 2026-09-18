import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  NOTIFICATIONS_CRITICAL_QUEUE,
  NOTIFICATIONS_REDIS_CONNECTION,
  NOTIFICATIONS_STANDARD_QUEUE,
  REPORTS_QUEUE,
} from './queue.constants';

/**
 * `Queue` instances are plain objects from `useFactory` providers — Nest
 * has no built-in lifecycle hook for them, so without this they (and the
 * shared Redis connection backing both of them) leak past `app.close()`.
 * Every e2e spec boots the full `AppModule` (this module is `@Global()`),
 * so an unclosed connection here would otherwise leave Jest hanging ("A
 * worker process has failed to exit gracefully") across the ENTIRE e2e
 * suite, not just notification-specific specs.
 *
 * `queue.close()` alone is NOT sufficient when the connection was
 * supplied externally (as it is here, via `NOTIFICATIONS_REDIS_CONNECTION`)
 * — BullMQ only auto-closes a connection it created itself. The
 * connection must be explicitly `.quit()`ed here, once, after both queues
 * have finished closing.
 */
@Injectable()
export class QueueShutdownService implements OnModuleDestroy {
  constructor(
    @Inject(NOTIFICATIONS_CRITICAL_QUEUE) private readonly criticalQueue: Queue,
    @Inject(NOTIFICATIONS_STANDARD_QUEUE) private readonly standardQueue: Queue,
    @Inject(REPORTS_QUEUE) private readonly reportsQueue: Queue,
    @Inject(NOTIFICATIONS_REDIS_CONNECTION) private readonly connection: IORedis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.criticalQueue.close(), this.standardQueue.close(), this.reportsQueue.close()]);
    await this.connection.quit();
  }
}
