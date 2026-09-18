import { NotFoundException } from '@nestjs/common';
import { NotificationChannel } from '@exam-sync/db';
import { NotificationsService } from './notifications.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return {
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any;
}

const student: AuthenticatedUser = { id: 'user-1', email: 's@example.com', roles: ['STUDENT'] };

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new NotificationsService(prisma);
  });

  describe('listMine — BR-045 self-only, IN_APP-only inbox', () => {
    it('queries only this actor\'s IN_APP rows, newest first', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.listMine(student, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { recipientId: 'user-1', channel: NotificationChannel.IN_APP },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('cursor-paginates using the shared pagination helpers', async () => {
      const rows = Array.from({ length: 26 }, (_, i) => ({ id: `n${i}` }));
      prisma.notification.findMany.mockResolvedValue(rows);

      const result = await service.listMine(student, {});

      expect(result.items).toHaveLength(25);
      expect(result.next_cursor).toBe('n24');
    });
  });

  describe('markRead', () => {
    it('404s when the notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);
      await expect(service.markRead('missing', student)).rejects.toThrow(NotFoundException);
    });

    it('404s (not 403) when the notification belongs to a different recipient — BR-045/ADR-008 IDOR posture', async () => {
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', recipientId: 'someone-else' });
      await expect(service.markRead('n1', student)).rejects.toThrow(NotFoundException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('marks an unread notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', recipientId: 'user-1', readAt: null });
      prisma.notification.update.mockResolvedValue({ id: 'n1', recipientId: 'user-1', readAt: new Date() });

      const result = await service.markRead('n1', student);

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { readAt: expect.any(Date) },
      });
      expect(result.readAt).toBeTruthy();
    });

    it('is idempotent — re-marking an already-read notification is a no-op success, not an error (BR-050)', async () => {
      const alreadyRead = { id: 'n1', recipientId: 'user-1', readAt: new Date('2026-01-01') };
      prisma.notification.findUnique.mockResolvedValue(alreadyRead);

      const result = await service.markRead('n1', student);

      expect(result).toEqual(alreadyRead);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });
});
