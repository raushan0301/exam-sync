import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, Prisma, SuspensionRequestStatus } from '@exam-sync/db';
import { ExamSessionSuspensionService } from './exam-session-suspension.service';
import { ExamSessionsService } from './exam-sessions.service';
import { ExamSessionOwnershipService } from './exam-session-ownership.service';
import { FacultyService } from '../faculty';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    examSessionSuspensionRequest: { create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return {
    examSessionSuspensionRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'a@x.com', roles: [ROLE.ADMIN], mustChangePassword: false };
const facultyActor: AuthenticatedUser = { id: 'user-fac-1', email: 'f@x.com', roles: [ROLE.FACULTY], mustChangePassword: false };

const session = { id: 's1', name: 'Cyber quiz 1 — Exam', status: ExamSessionStatus.ROOM_ALLOCATION };
const REASON = 'The venue has been double-booked and cannot be moved.';

describe('ExamSessionSuspensionService — suspension = cancellation behind an admin approval', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let notificationsOutbox: { queue: jest.Mock };
  let examSessionsService: { findById: jest.Mock; cancelSession: jest.Mock };
  let ownership: { isOwnerOrCoInstructor: jest.Mock };
  let facultyService: { findByUserId: jest.Mock };
  let service: ExamSessionSuspensionService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    notificationsOutbox = { queue: jest.fn() };
    examSessionsService = { findById: jest.fn().mockResolvedValue(session), cancelSession: jest.fn() };
    ownership = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };
    facultyService = { findByUserId: jest.fn().mockResolvedValue({ id: 'fac-1', name: 'Dr. Smith', userId: facultyActor.id }) };
    service = new ExamSessionSuspensionService(
      prisma,
      auditHook as unknown as AuditHookService,
      notificationsOutbox as unknown as NotificationsOutboxService,
      examSessionsService as unknown as ExamSessionsService,
      ownership as unknown as ExamSessionOwnershipService,
      facultyService as unknown as FacultyService,
    );
  });

  describe('request', () => {
    beforeEach(() => {
      prisma.examSessionSuspensionRequest.findFirst.mockResolvedValue(null);
      prisma.__tx.examSessionSuspensionRequest.create.mockResolvedValue({
        id: 'req-1', examSessionId: 's1', reason: REASON, status: SuspensionRequestStatus.PENDING,
      });
      prisma.__tx.user.findMany.mockResolvedValue([{ id: 'admin-user-1' }, { id: 'admin-user-2' }]);
    });

    it('creates a PENDING request with the faculty and trimmed reason, notifies every admin, and audits it — all in one transaction', async () => {
      const created = await service.request('s1', { reason: `  ${REASON}  ` }, facultyActor);

      expect(created.id).toBe('req-1');
      expect(prisma.__tx.examSessionSuspensionRequest.create).toHaveBeenCalledWith({
        data: { examSessionId: 's1', requestedByFacultyId: 'fac-1', reason: REASON },
      });
      expect(notificationsOutbox.queue).toHaveBeenCalledTimes(2);
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({
          eventType: 'SUSPENSION_REQUESTED',
          recipientId: 'admin-user-1',
          payload: expect.objectContaining({ session_name: 'Cyber quiz 1 — Exam', faculty_name: 'Dr. Smith', reason: REASON }),
        }),
      );
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'ExamSessionSuspensionRequest', reason: REASON }),
        prisma.__tx,
      );
    });

    it('does NOT cancel anything — the session is untouched until an admin approves', async () => {
      await service.request('s1', { reason: REASON }, facultyActor);
      expect(examSessionsService.cancelSession).not.toHaveBeenCalled();
    });

    it('404s a faculty who owns/co-instructs none of the session\'s quizzes (IDOR-safe)', async () => {
      ownership.isOwnerOrCoInstructor.mockResolvedValue(false);
      await expect(service.request('s1', { reason: REASON }, facultyActor)).rejects.toThrow(NotFoundException);
      expect(prisma.__tx.examSessionSuspensionRequest.create).not.toHaveBeenCalled();
    });

    it('403s a caller with no faculty record', async () => {
      facultyService.findByUserId.mockResolvedValue(null);
      await expect(service.request('s1', { reason: REASON }, facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it.each([ExamSessionStatus.IN_PROGRESS, ExamSessionStatus.COMPLETED, ExamSessionStatus.CANCELLED])(
      '409s when the session is %s — nothing left to suspend',
      async (status) => {
        examSessionsService.findById.mockResolvedValue({ ...session, status });
        await expect(service.request('s1', { reason: REASON }, facultyActor)).rejects.toThrow(ConflictException);
      },
    );

    it('409s when a request for this session is already pending', async () => {
      prisma.examSessionSuspensionRequest.findFirst.mockResolvedValue({ id: 'req-old' });
      await expect(service.request('s1', { reason: REASON }, facultyActor)).rejects.toThrow(/already waiting for admin review/);
      expect(prisma.__tx.examSessionSuspensionRequest.create).not.toHaveBeenCalled();
    });

    it('turns the partial-unique-index violation from a concurrent duplicate into the same clear 409', async () => {
      prisma.__tx.examSessionSuspensionRequest.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(service.request('s1', { reason: REASON }, facultyActor)).rejects.toThrow(/already waiting for admin review/);
    });
  });

  describe('list', () => {
    const row = {
      id: 'req-1', examSessionId: 's1', requestedByFacultyId: 'fac-1', reason: REASON, status: 'PENDING',
      examSession: { name: 'Cyber quiz 1 — Exam', sessionDate: new Date('2026-09-22'), startTime: new Date(), endTime: new Date(), status: 'ROOM_ALLOCATION' },
      requestedByFaculty: { name: 'Dr. Smith', employeeCode: 'E001' },
    };

    it('ADMIN: sees everyone\'s requests, unscoped, with readable labels', async () => {
      prisma.examSessionSuspensionRequest.findMany.mockResolvedValue([row]);

      const page = await service.list(admin, { status: SuspensionRequestStatus.PENDING });

      const where = prisma.examSessionSuspensionRequest.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ status: 'PENDING' }); // no faculty filter
      expect(facultyService.findByUserId).not.toHaveBeenCalled();
      expect(page.items[0]).toEqual(expect.objectContaining({ examSessionName: 'Cyber quiz 1 — Exam', facultyName: 'Dr. Smith', facultyEmployeeCode: 'E001' }));
    });

    it('FACULTY: only the requests they filed', async () => {
      prisma.examSessionSuspensionRequest.findMany.mockResolvedValue([row]);
      await service.list(facultyActor, {});
      expect(prisma.examSessionSuspensionRequest.findMany.mock.calls[0][0].where).toEqual({ requestedByFacultyId: 'fac-1' });
    });

    it('FACULTY with no faculty record gets an empty page, not an error or someone else\'s data', async () => {
      facultyService.findByUserId.mockResolvedValue(null);
      prisma.examSessionSuspensionRequest.findMany.mockResolvedValue([]);
      const page = await service.list(facultyActor, {});
      expect(page.items).toEqual([]);
      expect(prisma.examSessionSuspensionRequest.findMany.mock.calls[0][0].where.requestedByFacultyId).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('filters by exam session (the session page shows its own latest request)', async () => {
      prisma.examSessionSuspensionRequest.findMany.mockResolvedValue([]);
      await service.list(facultyActor, { examSessionId: 's1' });
      expect(prisma.examSessionSuspensionRequest.findMany.mock.calls[0][0].where).toEqual({ requestedByFacultyId: 'fac-1', examSessionId: 's1' });
    });
  });

  describe('approve', () => {
    const pending = {
      id: 'req-1', examSessionId: 's1', reason: REASON, status: SuspensionRequestStatus.PENDING,
      examSession: { name: 'Cyber quiz 1 — Exam' }, requestedByFaculty: { userId: 'user-fac-1', name: 'Dr. Smith' },
    };

    beforeEach(() => {
      prisma.examSessionSuspensionRequest.findUnique.mockResolvedValue(pending);
      prisma.examSessionSuspensionRequest.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'APPROVED' });
      prisma.__tx.examSessionSuspensionRequest.updateMany.mockResolvedValue({ count: 1 });
      // Run the cancellation's in-transaction hook the way the real service does.
      examSessionsService.cancelSession.mockImplementation(async (_id: string, _reason: string, _actor: unknown, hook: any) => {
        await hook(prisma.__tx);
        return { id: 's1', status: ExamSessionStatus.CANCELLED };
      });
    });

    it('cancels the session with the faculty\'s reason, and marks the request APPROVED in the SAME transaction', async () => {
      await service.approve('req-1', { note: 'Rebook in November' }, admin);

      expect(examSessionsService.cancelSession).toHaveBeenCalledWith('s1', REASON, admin, expect.any(Function));
      expect(prisma.__tx.examSessionSuspensionRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'APPROVED', reviewedByAdminId: 'admin-1', reviewNote: 'Rebook in November' }),
      });
    });

    it('notifies the requesting faculty, with the admin\'s note', async () => {
      await service.approve('req-1', { note: 'Rebook in November' }, admin);

      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({
          recipientType: 'FACULTY',
          recipientId: 'user-fac-1',
          eventType: 'SUSPENSION_APPROVED',
          payload: expect.objectContaining({ session_name: 'Cyber quiz 1 — Exam', note: 'Rebook in November' }),
        }),
      );
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'ExamSessionSuspensionRequest', newValue: { status: 'APPROVED' } }),
        prisma.__tx,
      );
    });

    it('the note is optional', async () => {
      await service.approve('req-1', {}, admin);
      expect(prisma.__tx.examSessionSuspensionRequest.updateMany.mock.calls[0][0].data.reviewNote).toBeNull();
    });

    it('aborts if someone else reviewed it in the meantime (the guarded update matched nothing)', async () => {
      prisma.__tx.examSessionSuspensionRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve('req-1', {}, admin)).rejects.toThrow(/already reviewed by someone else/);
      expect(notificationsOutbox.queue).not.toHaveBeenCalled();
    });

    it('surfaces the cancellation\'s own 409 when the session has since started — and marks nothing approved', async () => {
      examSessionsService.cancelSession.mockRejectedValue(new ConflictException('Exam session is in status "IN_PROGRESS" and cannot be cancelled.'));
      await expect(service.approve('req-1', {}, admin)).rejects.toThrow(/IN_PROGRESS/);
      expect(prisma.__tx.examSessionSuspensionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('409s an already-reviewed request, 404s a missing one', async () => {
      prisma.examSessionSuspensionRequest.findUnique.mockResolvedValue({ ...pending, status: SuspensionRequestStatus.REJECTED });
      await expect(service.approve('req-1', {}, admin)).rejects.toThrow(/already rejected/);
      expect(examSessionsService.cancelSession).not.toHaveBeenCalled();

      prisma.examSessionSuspensionRequest.findUnique.mockResolvedValue(null);
      await expect(service.approve('nope', {}, admin)).rejects.toThrow(NotFoundException);
    });
  });

  describe('reject', () => {
    const pending = {
      id: 'req-1', examSessionId: 's1', reason: REASON, status: SuspensionRequestStatus.PENDING,
      examSession: { name: 'Cyber quiz 1 — Exam' }, requestedByFaculty: { userId: 'user-fac-1', name: 'Dr. Smith' },
    };

    beforeEach(() => {
      prisma.examSessionSuspensionRequest.findUnique.mockResolvedValue(pending);
      prisma.__tx.examSessionSuspensionRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.__tx.examSessionSuspensionRequest.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'REJECTED' });
    });

    it('marks it REJECTED with the admin\'s reason, notifies the faculty, and leaves the session completely untouched', async () => {
      await service.reject('req-1', { note: '  The exam must go ahead.  ' }, admin);

      expect(prisma.__tx.examSessionSuspensionRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'REJECTED', reviewedByAdminId: 'admin-1', reviewNote: 'The exam must go ahead.' }),
      });
      expect(examSessionsService.cancelSession).not.toHaveBeenCalled();
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({
          recipientId: 'user-fac-1',
          eventType: 'SUSPENSION_REJECTED',
          payload: expect.objectContaining({ note: 'The exam must go ahead.' }),
        }),
      );
    });

    it('409s when it was already reviewed (concurrent review race)', async () => {
      prisma.__tx.examSessionSuspensionRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject('req-1', { note: 'no' }, admin)).rejects.toThrow(/already reviewed by someone else/);
    });
  });
});
