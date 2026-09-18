import { NotificationEventType, NotificationStatus } from '@exam-sync/db';
import { NotificationRelayService } from './notification-relay.service';

function buildPrismaMock(rows: { id: string; eventType: string }[] = []) {
  return { notification: { findMany: jest.fn().mockResolvedValue(rows) } } as any;
}

function buildQueueMock() {
  return { add: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('NotificationRelayService', () => {
  it('polls for PENDING/RETRYING rows that are due and enqueues each into the right lane', async () => {
    const rows = [
      { id: 'n1', eventType: NotificationEventType.QUIZ_APPROVED },
      { id: 'n2', eventType: NotificationEventType.EXAM_SESSION_CANCELLED },
    ];
    const prisma = buildPrismaMock(rows);
    const critical = buildQueueMock();
    const standard = buildQueueMock();
    const relay = new NotificationRelayService(prisma, critical, standard);

    await relay.pollAndDispatch();

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [NotificationStatus.PENDING, NotificationStatus.RETRYING] },
        }),
      }),
    );
    expect(standard.add).toHaveBeenCalledWith(
      'deliver',
      { notificationId: 'n1' },
      expect.objectContaining({ jobId: 'n1' }),
    );
    expect(critical.add).toHaveBeenCalledWith(
      'deliver',
      { notificationId: 'n2' },
      expect.objectContaining({ jobId: 'n2' }),
    );
  });

  it('uses the notification id as the BullMQ job id (dedup-safe re-polling)', async () => {
    const prisma = buildPrismaMock([{ id: 'n1', eventType: NotificationEventType.QUIZ_APPROVED }]);
    const critical = buildQueueMock();
    const standard = buildQueueMock();
    const relay = new NotificationRelayService(prisma, critical, standard);

    await relay.pollAndDispatch();
    await relay.pollAndDispatch();

    expect(standard.add).toHaveBeenCalledTimes(2);
    const jobIds = standard.add.mock.calls.map((c: any) => c[2].jobId);
    expect(jobIds).toEqual(['n1', 'n1']);
  });

  it('does not throw when the DB poll itself fails — logs and returns (no crash loop)', async () => {
    const prisma = { notification: { findMany: jest.fn().mockRejectedValue(new Error('db down')) } } as any;
    const critical = buildQueueMock();
    const standard = buildQueueMock();
    const relay = new NotificationRelayService(prisma, critical, standard);

    await expect(relay.pollAndDispatch()).resolves.toBeUndefined();
    expect(critical.add).not.toHaveBeenCalled();
    expect(standard.add).not.toHaveBeenCalled();
  });

  it('continues enqueuing remaining rows when one enqueue attempt fails (queue temporarily down)', async () => {
    const rows = [
      { id: 'n1', eventType: NotificationEventType.QUIZ_APPROVED },
      { id: 'n2', eventType: NotificationEventType.QUIZ_REJECTED },
    ];
    const prisma = buildPrismaMock(rows);
    const critical = buildQueueMock();
    const standard = buildQueueMock();
    standard.add.mockRejectedValueOnce(new Error('redis unreachable')).mockResolvedValueOnce(undefined);
    const relay = new NotificationRelayService(prisma, critical, standard);

    await expect(relay.pollAndDispatch()).resolves.toBeUndefined();
    expect(standard.add).toHaveBeenCalledTimes(2);
  });
});
