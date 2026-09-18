import { NotificationChannel, NotificationEventType, NotificationRecipientType } from '@exam-sync/db';
import { NotificationsOutboxService } from './notifications-outbox.service';

function buildPrismaMock() {
  return {
    notification: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  } as any;
}

describe('NotificationsOutboxService', () => {
  it('fans out to one row per required channel (IN_APP + EMAIL)', async () => {
    const prisma = buildPrismaMock();
    const service = new NotificationsOutboxService(prisma);

    await service.queue(prisma, {
      recipientType: NotificationRecipientType.FACULTY,
      recipientId: 'user-1',
      eventType: NotificationEventType.QUIZ_APPROVED,
      entityId: 'quiz-1',
      entityVersion: 2,
      payload: { quiz_title: 'DBMS Midterm' },
    });

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const call = prisma.notification.createMany.mock.calls[0][0];
    expect(call.data).toHaveLength(2);
    expect(call.data.map((r: any) => r.channel).sort()).toEqual(
      [NotificationChannel.IN_APP, NotificationChannel.EMAIL].sort(),
    );
    expect(call.skipDuplicates).toBe(true);
  });

  it('derives a distinct idempotency key per channel for the same logical event', async () => {
    const prisma = buildPrismaMock();
    const service = new NotificationsOutboxService(prisma);

    await service.queue(prisma, {
      recipientType: NotificationRecipientType.STUDENT,
      recipientId: 'user-2',
      eventType: NotificationEventType.SEAT_ASSIGNED,
      entityId: 'seating-assignment-1',
      entityVersion: 1,
      payload: {},
    });

    const call = prisma.notification.createMany.mock.calls[0][0];
    const keys = call.data.map((r: any) => r.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('produces the SAME idempotency key when called twice with identical params (redelivery-safe, BR-043)', async () => {
    const prisma = buildPrismaMock();
    const service = new NotificationsOutboxService(prisma);
    const params = {
      recipientType: NotificationRecipientType.STUDENT,
      recipientId: 'user-3',
      eventType: NotificationEventType.EXAM_SESSION_CANCELLED,
      entityId: 'session-1',
      entityVersion: 'CANCELLED',
      payload: { reason: 'venue unavailable' },
    };

    await service.queue(prisma, params);
    await service.queue(prisma, params);

    const firstKeys = prisma.notification.createMany.mock.calls[0][0].data.map((r: any) => r.idempotencyKey);
    const secondKeys = prisma.notification.createMany.mock.calls[1][0].data.map((r: any) => r.idempotencyKey);
    expect(secondKeys).toEqual(firstKeys);
  });

  it('writes through the given transaction client when provided, not the injected PrismaService', async () => {
    const injectedPrisma = buildPrismaMock();
    const tx = buildPrismaMock();
    const service = new NotificationsOutboxService(injectedPrisma);

    await service.queue(tx, {
      recipientType: NotificationRecipientType.ADMIN,
      recipientId: 'admin-1',
      eventType: NotificationEventType.QUIZ_REJECTED,
      entityId: 'quiz-2',
      entityVersion: 3,
      payload: {},
    });

    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(injectedPrisma.notification.createMany).not.toHaveBeenCalled();
  });
});
