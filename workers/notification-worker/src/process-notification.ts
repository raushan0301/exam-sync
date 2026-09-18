import { NotificationChannel, NotificationStatus, PrismaClient } from '@exam-sync/db';
import { decideRetry, renderMessage } from '@exam-sync/domain-logic';
import { EmailProvider } from './email-provider';

export interface ProcessNotificationDeps {
  prisma: PrismaClient;
  emailProvider: EmailProvider;
  /** Injectable clock — tests need deterministic backoff timestamps. */
  now?: () => Date;
}

/**
 * One BullMQ job's worth of work: load the row, attempt delivery on its
 * channel, and write the result back (ARCHITECTURE.md §AB's flow diagram
 * final step: "delivery result written back ... with attempt count").
 *
 * Deliberately idempotent against redelivery of the SAME BullMQ job (at
 * one point Redis/BullMQ itself could redeliver after a worker crash
 * mid-processing): a row already `SENT` or `DEAD_LETTER` is a silent
 * no-op — retry/DLQ state lives entirely in Postgres (ADR-005), never in
 * BullMQ, so re-running this function against an already-terminal row is
 * always safe.
 *
 * `IN_APP` delivery is trivial success — EC-025's "in-app notification
 * still shows regardless of email/push provider status" only makes sense
 * if the in-app row's own delivery never depends on any external
 * provider; the DB write already committed by the outbox IS the
 * delivery. Only `EMAIL` goes through a real (here: placeholder,
 * `ConsoleEmailProvider`) provider call that can actually fail and enter
 * the retry/backoff/DLQ path.
 */
export async function processNotification(
  notificationId: string,
  deps: ProcessNotificationDeps,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const notification = await deps.prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) {
    return;
  }
  if (notification.status === NotificationStatus.SENT || notification.status === NotificationStatus.DEAD_LETTER) {
    return;
  }

  try {
    if (notification.channel === NotificationChannel.EMAIL) {
      const recipient = await deps.prisma.user.findUnique({ where: { id: notification.recipientId } });
      if (!recipient) {
        throw new Error(`Recipient user ${notification.recipientId} not found`);
      }
      const message = renderMessage(notification.eventType, notification.payload as Record<string, unknown>);
      await deps.emailProvider.send({ to: recipient.email, subject: message.title, body: message.body });
    }
    // IN_APP: no provider call — the row itself is the delivery.

    await deps.prisma.notification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.SENT, sentAt: now(), lastError: null },
    });
  } catch (err) {
    const attemptCount = notification.attemptCount + 1;
    const decision = decideRetry(attemptCount, now());
    await deps.prisma.notification.update({
      where: { id: notification.id },
      data: {
        attemptCount,
        lastError: (err as Error).message,
        status: decision.outcome === 'DEAD_LETTER' ? NotificationStatus.DEAD_LETTER : NotificationStatus.RETRYING,
        nextAttemptAt: decision.outcome === 'RETRYING' ? decision.nextAttemptAt : null,
      },
    });
    if (decision.outcome === 'DEAD_LETTER') {
      // BR-044: "never silently dropped without a record" — the DEAD_LETTER
      // status write above IS that record; this is the "raises an
      // operational alert" half. No real paging/alerting integration
      // (PagerDuty et al.) is wired — ARCHITECTURE.md names no specific
      // vendor for it — so a structured, greppable error log is the
      // disclosed placeholder, same posture as `ConsoleEmailProvider`.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          alert: 'NOTIFICATION_DEAD_LETTER',
          notificationId: notification.id,
          eventType: notification.eventType,
          channel: notification.channel,
          recipientId: notification.recipientId,
          attemptCount,
        }),
      );
    }
  }
}
