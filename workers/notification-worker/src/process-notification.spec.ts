import { NotificationChannel, NotificationEventType, NotificationStatus } from '@exam-sync/db';
import { processNotification } from './process-notification';
import { EmailProvider } from './email-provider';

function buildPrismaMock(notification: any) {
  return {
    notification: {
      findUnique: jest.fn().mockResolvedValue(notification),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...notification, ...data })),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: notification?.recipientId, email: 'student@example.com' }),
    },
  } as any;
}

function baseNotification(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'n1',
    recipientType: 'STUDENT',
    recipientId: 'user-1',
    eventType: NotificationEventType.QUIZ_APPROVED,
    channel: NotificationChannel.IN_APP,
    payload: { quiz_title: 'DBMS Midterm' },
    status: NotificationStatus.PENDING,
    attemptCount: 0,
    lastError: null,
    nextAttemptAt: null,
    ...overrides,
  };
}

describe('processNotification', () => {
  it('IN_APP: marks SENT without ever calling the email provider', async () => {
    const notification = baseNotification();
    const prisma = buildPrismaMock(notification);
    const emailProvider: EmailProvider = { send: jest.fn() };

    await processNotification('n1', { prisma, emailProvider });

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { status: NotificationStatus.SENT, sentAt: expect.any(Date), lastError: null },
    });
  });

  it('EMAIL: renders the message and calls the provider, then marks SENT on success', async () => {
    const notification = baseNotification({ channel: NotificationChannel.EMAIL });
    const prisma = buildPrismaMock(notification);
    const send = jest.fn().mockResolvedValue(undefined);
    const emailProvider: EmailProvider = { send };

    await processNotification('n1', { prisma, emailProvider });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'student@example.com', subject: 'Quiz approved' }),
    );
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: NotificationStatus.SENT }) }),
    );
  });

  it('EMAIL failure on the 1st attempt: moves to RETRYING with a 1-minute nextAttemptAt (BR-044 backoff)', async () => {
    const notification = baseNotification({ channel: NotificationChannel.EMAIL, attemptCount: 0 });
    const prisma = buildPrismaMock(notification);
    const emailProvider: EmailProvider = { send: jest.fn().mockRejectedValue(new Error('SMTP down')) };
    const now = () => new Date('2026-01-01T00:00:00Z');

    await processNotification('n1', { prisma, emailProvider, now });

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: {
        attemptCount: 1,
        lastError: 'SMTP down',
        status: NotificationStatus.RETRYING,
        nextAttemptAt: new Date('2026-01-01T00:01:00Z'),
      },
    });
  });

  it('EMAIL failure on the 6th attempt (5 retries already exhausted): moves to DEAD_LETTER (BR-044 exhaustion)', async () => {
    const notification = baseNotification({ channel: NotificationChannel.EMAIL, attemptCount: 5 });
    const prisma = buildPrismaMock(notification);
    const emailProvider: EmailProvider = { send: jest.fn().mockRejectedValue(new Error('SMTP down')) };

    await processNotification('n1', { prisma, emailProvider });

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: {
        attemptCount: 6,
        lastError: 'SMTP down',
        status: NotificationStatus.DEAD_LETTER,
        nextAttemptAt: null,
      },
    });
  });

  it('is a no-op for an already-SENT row (idempotent against BullMQ redelivery)', async () => {
    const notification = baseNotification({ status: NotificationStatus.SENT });
    const prisma = buildPrismaMock(notification);
    const emailProvider: EmailProvider = { send: jest.fn() };

    await processNotification('n1', { prisma, emailProvider });

    expect(prisma.notification.update).not.toHaveBeenCalled();
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('is a no-op for an already-DEAD_LETTER row', async () => {
    const notification = baseNotification({ status: NotificationStatus.DEAD_LETTER });
    const prisma = buildPrismaMock(notification);
    const emailProvider: EmailProvider = { send: jest.fn() };

    await processNotification('n1', { prisma, emailProvider });

    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('reprocesses a RETRYING row (the relay only enqueues once nextAttemptAt is due)', async () => {
    const notification = baseNotification({ status: NotificationStatus.RETRYING, attemptCount: 2 });
    const prisma = buildPrismaMock(notification);
    const emailProvider: EmailProvider = { send: jest.fn().mockResolvedValue(undefined) };

    await processNotification('n1', { prisma, emailProvider });

    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: NotificationStatus.SENT }) }),
    );
  });

  it('does nothing (no throw) when the row no longer exists', async () => {
    const prisma = buildPrismaMock(null);
    const emailProvider: EmailProvider = { send: jest.fn() };

    await expect(processNotification('missing', { prisma, emailProvider })).resolves.toBeUndefined();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('EMAIL: a missing recipient user is treated as a failed delivery attempt, not an unhandled throw', async () => {
    const notification = baseNotification({ channel: NotificationChannel.EMAIL });
    const prisma = buildPrismaMock(notification);
    prisma.user.findUnique.mockResolvedValue(null);
    const emailProvider: EmailProvider = { send: jest.fn() };

    await expect(processNotification('n1', { prisma, emailProvider })).resolves.toBeUndefined();
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: NotificationStatus.RETRYING }) }),
    );
  });
});
