import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { NotificationStatus } from '@exam-sync/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATIONS_CRITICAL_QUEUE,
  NOTIFICATIONS_STANDARD_QUEUE,
  queueNameFor,
  CRITICAL_QUEUE_NAME,
} from './queue.constants';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 100;

/**
 * The relay half of the transactional-outbox pattern (ADR-005): a short
 * polling loop over `PENDING`/`RETRYING` rows that are due, publishing one
 * BullMQ job per row into the correct priority lane. ADR-005 explicitly
 * chose polling over Postgres `LISTEN/NOTIFY` or CDC ("sufficient ... keeps
 * the operational surface to 'one more background process'") — this
 * service IS that one process, running inside the API's own Nest
 * lifecycle rather than as a separate deployable (simpler; nothing about
 * the relay's job requires its own process boundary the way the actual
 * worker pool does, per ADR-001's narrowly-scoped exception).
 *
 * Enqueuing uses the notification row's own `id` as the BullMQ job id —
 * BullMQ treats `add()` with a job id that is still waiting/active/delayed
 * as a no-op rather than creating a duplicate, so re-polling the same due
 * row on every tick (before the worker has processed and removed it) is
 * safe and does not fan out duplicate jobs.
 *
 * If Redis/the queue is unreachable, `queue.add()` rejects and this tick's
 * `catch` logs and returns — rows simply stay `PENDING` in Postgres (the
 * durable source of truth) and are retried on the next tick once the
 * outage clears (EC-035, "no data loss, just delay").
 */
@Injectable()
export class NotificationRelayService {
  private readonly logger = new Logger(NotificationRelayService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATIONS_CRITICAL_QUEUE) private readonly criticalQueue: Queue,
    @Inject(NOTIFICATIONS_STANDARD_QUEUE) private readonly standardQueue: Queue,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async pollAndDispatch(): Promise<void> {
    const now = new Date();
    let due: { id: string; eventType: string }[];
    try {
      due = await this.prisma.notification.findMany({
        where: {
          status: { in: [NotificationStatus.PENDING, NotificationStatus.RETRYING] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, eventType: true },
      });
    } catch (err) {
      this.logger.error(`Failed to poll outbox rows: ${(err as Error).message}`);
      return;
    }

    for (const row of due) {
      const queueName = queueNameFor(row.eventType as never);
      const queue = queueName === CRITICAL_QUEUE_NAME ? this.criticalQueue : this.standardQueue;
      try {
        await queue.add(
          'deliver',
          { notificationId: row.id },
          // attempts: 1 — BullMQ's own retry is deliberately unused; all
          // retry/backoff/DLQ state lives in Postgres (ADR-005), see the
          // worker's own header comment.
          { jobId: row.id, attempts: 1, removeOnComplete: true, removeOnFail: true },
        );
      } catch (err) {
        this.logger.error(`Failed to enqueue notification ${row.id}: ${(err as Error).message}`);
      }
    }
  }
}
