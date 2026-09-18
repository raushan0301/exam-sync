/**
 * notification-worker — real implementation (Phase 15,
 * IMPLEMENTATION_PLAN.md: "Notifications ... queue, workers, retry/DLQ").
 *
 * A separate deployable process (ADR-001's one deliberate exception to
 * "everything ships in the monolith" — this Phase-0-skeleton's own
 * original comment already called this out). Runs two BullMQ `Worker`s,
 * one per priority lane (ARCHITECTURE.md §AN/ADR-005), each pulling jobs
 * the relay (`apps/api`'s `common/queue/notification-relay.service.ts`)
 * enqueued and running `processNotification` against them. All actual
 * retry/backoff/DLQ state lives in Postgres on the `notifications` row
 * (ADR-005) — BullMQ here is a plain at-least-once delivery mechanism for
 * "go process this row now," nothing more; jobs always complete
 * successfully from BullMQ's point of view (errors are caught and
 * resolved into a Postgres status write inside `processNotification`
 * itself), so BullMQ's own retry/backoff is deliberately unused
 * (`attempts: 1`).
 */
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { PrismaClient } from '@exam-sync/db';
import { CRITICAL_QUEUE_NAME, STANDARD_QUEUE_NAME } from '@exam-sync/domain-logic';
import { ConsoleEmailProvider } from './email-provider';
import { processNotification } from './process-notification';

const CRITICAL_CONCURRENCY = 10;
const STANDARD_CONCURRENCY = 5;

function main(): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    // eslint-disable-next-line no-console
    console.error('[notification-worker] REDIS_URL is not set — cannot start.');
    process.exit(1);
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const prisma = new PrismaClient();
  const emailProvider = new ConsoleEmailProvider();

  const handler = async (job: { data: { notificationId: string } }) => {
    await processNotification(job.data.notificationId, { prisma, emailProvider });
  };

  const criticalWorker = new Worker(CRITICAL_QUEUE_NAME, handler, {
    connection,
    concurrency: CRITICAL_CONCURRENCY,
  });
  const standardWorker = new Worker(STANDARD_QUEUE_NAME, handler, {
    connection,
    concurrency: STANDARD_CONCURRENCY,
  });

  for (const worker of [criticalWorker, standardWorker]) {
    worker.on('failed', (job, err) => {
      // A job should never actually "fail" here (processNotification
      // catches its own errors and writes RETRYING/DEAD_LETTER to
      // Postgres instead of throwing) — if BullMQ's own `failed` event
      // fires, something broke outside that contract (e.g. a DB
      // connection drop during the row read/write itself); log loudly,
      // the relay will simply re-enqueue this row's id on its next poll
      // since its Postgres status never left PENDING/RETRYING.
      // eslint-disable-next-line no-console
      console.error(`[notification-worker] job ${job?.id} failed unexpectedly: ${err.message}`);
    });
  }

  // eslint-disable-next-line no-console
  console.log('[notification-worker] started — consuming critical + standard lanes.');

  const shutdown = async () => {
    await Promise.all([criticalWorker.close(), standardWorker.close()]);
    await prisma.$disconnect();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  main();
}
