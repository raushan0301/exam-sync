import { ConflictException } from '@nestjs/common';
import { ExamSessionStatus, SeatingPlanStatus } from '@exam-sync/db';
import { ExamSessionLifecycleService } from './exam-session-lifecycle.service';
import { ExamSessionsService } from '../exam-session';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    examSession: { update: jest.fn() },
    attendance: { updateMany: jest.fn() },
  };
  return {
    examSessionRoom: { findMany: jest.fn() },
    seatingPlan: { findMany: jest.fn() },
    examSession: { update: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: [ROLE.ADMIN] };

describe('ExamSessionLifecycleService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let examSessionsService: { findById: jest.Mock };
  let service: ExamSessionLifecycleService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    examSessionsService = { findById: jest.fn() };
    service = new ExamSessionLifecycleService(
      prisma,
      auditHook as unknown as AuditHookService,
      examSessionsService as unknown as ExamSessionsService,
    );
  });

  describe('start', () => {
    it('rejects starting from a non-READY_FOR_FINALIZATION status', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.DRAFT });

      await expect(service.start('s1', admin)).rejects.toThrow(ConflictException);
    });

    it('rejects when a session has zero allocated rooms', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.READY_FOR_FINALIZATION });
      prisma.examSessionRoom.findMany.mockResolvedValue([]);
      prisma.seatingPlan.findMany.mockResolvedValue([]);

      await expect(service.start('s1', admin)).rejects.toThrow(ConflictException);
    });

    it('rejects when a room\'s seating plan is not FINALIZED', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.READY_FOR_FINALIZATION });
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }, { roomId: 'room-2' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([
        { roomId: 'room-1', status: SeatingPlanStatus.FINALIZED },
        { roomId: 'room-2', status: SeatingPlanStatus.VALIDATED },
      ]);

      await expect(service.start('s1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.examSession.update).not.toHaveBeenCalled();
    });

    it('transitions to IN_PROGRESS when every allocated room has a FINALIZED plan', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.READY_FOR_FINALIZATION });
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1', status: SeatingPlanStatus.FINALIZED }]);
      prisma.__tx.examSession.update.mockResolvedValue({ id: 's1', status: ExamSessionStatus.IN_PROGRESS, version: 2 });

      const result = await service.start('s1', admin);

      expect(result.status).toBe(ExamSessionStatus.IN_PROGRESS);
      expect(prisma.__tx.examSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: ExamSessionStatus.IN_PROGRESS, version: { increment: 1 } },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'ExamSession' }),
        expect.anything(),
      );
    });
  });

  describe('complete', () => {
    it('rejects completing a non-IN_PROGRESS session', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.NOTIFIED });

      await expect(service.complete('s1', admin)).rejects.toThrow(ConflictException);
    });

    it('transitions to COMPLETED and locks every attendance row for the session in the same transaction (BR-034)', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.IN_PROGRESS });
      prisma.__tx.examSession.update.mockResolvedValue({ id: 's1', status: ExamSessionStatus.COMPLETED, version: 3 });

      const result = await service.complete('s1', admin);

      expect(result.status).toBe(ExamSessionStatus.COMPLETED);
      expect(prisma.__tx.attendance.updateMany).toHaveBeenCalledWith({
        where: { quizStudentAssignment: { examSessionId: 's1' } },
        data: { locked: true },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'ExamSession' }),
        expect.anything(),
      );
    });
  });
});
