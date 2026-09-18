import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, Prisma, QuizStatus } from '@exam-sync/db';
import { ExamSessionsService } from './exam-sessions.service';
import { ConflictEngineService } from '../conflict-engine';
import { QuizzesService } from '../quiz';
import { ExamSessionsAccessRepository } from './exam-sessions-access.repository';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';

function buildPrismaMock() {
  const tx = {
    examSessionQuiz: { update: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    examSession: { create: jest.fn(), update: jest.fn() },
    quizStudentAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    student: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return {
    examSession: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    examSessionQuiz: { findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };

describe('ExamSessionsService (create, attach/detach, reschedule, cancel — conflictEngine mocked; real Conflict Engine has its own spec)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let conflictEngine: { checkSessionAssembly: jest.Mock };
  let quizzesService: { findById: jest.Mock };
  let accessRepository: { findScoped: jest.Mock };
  let notificationsOutbox: { queue: jest.Mock };
  let service: ExamSessionsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    conflictEngine = { checkSessionAssembly: jest.fn().mockResolvedValue({ hard: [], warnings: [] }) };
    quizzesService = { findById: jest.fn() };
    accessRepository = { findScoped: jest.fn() };
    notificationsOutbox = { queue: jest.fn() };

    service = new ExamSessionsService(
      prisma,
      auditHook as unknown as AuditHookService,
      conflictEngine as unknown as ConflictEngineService,
      quizzesService as unknown as QuizzesService,
      accessRepository as unknown as ExamSessionsAccessRepository,
      notificationsOutbox as unknown as NotificationsOutboxService,
    );
  });

  describe('create', () => {
    it('creates a DRAFT session and audits it', async () => {
      const created = { id: 's1', status: ExamSessionStatus.DRAFT, version: 1 };
      prisma.__tx.examSession.create.mockResolvedValue(created);

      const result = await service.create(
        { name: 'Mid-Sem Slot A', session_date: '2026-05-01', start_time: '10:00', end_time: '11:00' },
        admin,
      );

      expect(result).toEqual(created);
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'ExamSession' }),
        expect.anything(),
      );
    });
  });

  describe('attachAndDetachQuizzes — BR-011/BR-017 (unapproved), BR-053 (already attached elsewhere)', () => {
    const draftSession = {
      id: 's1',
      status: ExamSessionStatus.DRAFT,
      sessionDate: new Date('2026-05-01'),
      startTime: new Date('1970-01-01T10:00:00Z'),
      endTime: new Date('1970-01-01T11:00:00Z'),
    };

    it('rejects modifying quizzes on a non-DRAFT session with 409', async () => {
      prisma.examSession.findUnique.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED });

      await expect(
        service.attachAndDetachQuizzes('s1', { add: [], remove: [] }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s when an `add` quiz id does not exist at all', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.attachAndDetachQuizzes('s1', { add: ['missing-quiz'], remove: [] }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('collects an UNAPPROVED_QUIZ hard conflict for a non-APPROVED quiz — never attaches it', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', status: QuizStatus.DRAFT });

      const error = await service
        .attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, admin)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().details).toEqual([
        expect.objectContaining({ type: 'UNAPPROVED_QUIZ', quizId: 'quiz-1' }),
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('BR-053: collects a QUIZ_ALREADY_ATTACHED_ELSEWHERE hard conflict for a quiz active in a different session', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', status: QuizStatus.APPROVED });
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 'OTHER-SESSION', quizId: 'quiz-1' });

      const error = await service
        .attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, admin)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().details).toEqual([
        expect.objectContaining({ type: 'QUIZ_ALREADY_ATTACHED_ELSEWHERE', quizId: 'quiz-1' }),
      ]);
    });

    it('collects MULTIPLE hard conflicts across a batch — never fails fast on the first bad quiz', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'quiz-unapproved'
            ? { id, status: QuizStatus.DRAFT }
            : { id, status: QuizStatus.APPROVED },
        ),
      );
      prisma.examSessionQuiz.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.quizId === 'quiz-elsewhere' ? { examSessionId: 'OTHER', quizId: 'quiz-elsewhere' } : null,
        ),
      );

      const error = await service
        .attachAndDetachQuizzes(
          's1',
          { add: ['quiz-unapproved', 'quiz-elsewhere'], remove: [] },
          admin,
        )
        .catch((e) => e);

      const details = error.getResponse().details;
      expect(details).toHaveLength(2);
      expect(details.map((d: any) => d.type).sort()).toEqual(
        ['QUIZ_ALREADY_ATTACHED_ELSEWHERE', 'UNAPPROVED_QUIZ'].sort(),
      );
    });

    it('treats re-adding an already-actively-attached quiz as a no-op, not an error', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-already-here' }]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      await service.attachAndDetachQuizzes('s1', { add: ['quiz-already-here'], remove: [] }, admin);

      expect(quizzesService.findById).not.toHaveBeenCalled(); // never re-validated — it's already attached here
      expect(prisma.__tx.examSessionQuiz.upsert).not.toHaveBeenCalled();
    });

    it('attaches an approved, unattached quiz via upsert (handles re-attach-after-detach correctly)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', status: QuizStatus.APPROVED });
      prisma.examSessionQuiz.findFirst.mockResolvedValue(null);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      await service.attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, admin);

      expect(prisma.__tx.examSessionQuiz.upsert).toHaveBeenCalledWith({
        where: { examSessionId_quizId: { examSessionId: 's1', quizId: 'quiz-1' } },
        create: { examSessionId: 's1', quizId: 'quiz-1', isActiveAttachment: true },
        update: { isActiveAttachment: true, detachedAt: null, attachedAt: expect.any(Date) },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'ExamSession' }),
        expect.anything(),
      );
    });

    it('detaches a currently-attached quiz (soft — isActiveAttachment=false, never a physical delete)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-to-remove' }]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      await service.attachAndDetachQuizzes('s1', { add: [], remove: ['quiz-to-remove'] }, admin);

      expect(prisma.__tx.examSessionQuiz.update).toHaveBeenCalledWith({
        where: { examSessionId_quizId: { examSessionId: 's1', quizId: 'quiz-to-remove' } },
        data: { isActiveAttachment: false, detachedAt: expect.any(Date) },
      });
    });

    it('silently ignores a `remove` id that is not currently attached (nothing to do)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      await service.attachAndDetachQuizzes('s1', { add: [], remove: ['not-attached'] }, admin);

      expect(prisma.__tx.examSessionQuiz.update).not.toHaveBeenCalled();
    });

    it('consults the conflict-engine STUB when adding quizzes — merges its (currently always-empty) hard list', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', status: QuizStatus.APPROVED });
      prisma.examSessionQuiz.findFirst.mockResolvedValue(null);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      await service.attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, admin);

      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(
        expect.objectContaining({ examSessionId: 's1', quizIds: ['quiz-1'] }),
        prisma.__tx, // the SAME transaction client the write happens in (SERIALIZABLE check-then-write atomicity)
      );
    });

    it('opens the write transaction at SERIALIZABLE isolation (ADR-003)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      await service.attachAndDetachQuizzes('s1', { add: [], remove: [] }, admin);

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('a Conflict Engine hard conflict found INSIDE the transaction (a genuine race the app-level pre-check could not see) aborts the write — nothing is attached', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', status: QuizStatus.APPROVED });
      prisma.examSessionQuiz.findFirst.mockResolvedValue(null); // pre-check outside the tx sees no conflict yet
      conflictEngine.checkSessionAssembly.mockResolvedValue({
        hard: [{ type: 'STUDENT_OVERLAP', studentId: 'student-1', message: 'conflict' }],
        warnings: [],
      });

      await expect(
        service.attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.__tx.examSessionQuiz.upsert).not.toHaveBeenCalled();
      expect(prisma.__tx.examSession.update).not.toHaveBeenCalled();
    });

    it('maps a concurrent BR-053 unique-constraint violation (P2002) on the upsert itself to a clean 409, never a raw 500 (ADR-003 Implementation Notes)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', status: QuizStatus.APPROVED });
      prisma.examSessionQuiz.findFirst.mockResolvedValue(null);
      prisma.__tx.examSessionQuiz.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );

      const error = await service
        .attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, admin)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().details).toEqual([
        expect.objectContaining({ type: 'QUIZ_ALREADY_ATTACHED_ELSEWHERE', quizId: 'quiz-1' }),
      ]);
    });

    it('transparently retries once on a P2034 write-conflict (the expected outcome of a genuine SERIALIZABLE race) and succeeds on the retry', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });
      prisma.$transaction
        .mockImplementationOnce(() =>
          Promise.reject(
            new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict', {
              code: 'P2034',
              clientVersion: '5.22.0',
            }),
          ),
        )
        .mockImplementationOnce((cb: any) => cb(prisma.__tx));

      const result = await service.attachAndDetachQuizzes('s1', { add: [], remove: [] }, admin);

      expect(result.version).toBe(2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('reschedule — EC-021 (re-runs conflict check before committing)', () => {
    const draftSession = {
      id: 's1',
      status: ExamSessionStatus.DRAFT,
      sessionDate: new Date('2026-05-01'),
      startTime: new Date('1970-01-01T10:00:00Z'),
      endTime: new Date('1970-01-01T11:00:00Z'),
    };

    it('rejects rescheduling a non-DRAFT session with 409', async () => {
      prisma.examSession.findUnique.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED });

      await expect(
        service.reschedule('s1', { session_date: '2026-06-01', start_time: '09:00', end_time: '10:00' }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks the reschedule if the conflict engine reports a hard conflict', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSessionQuiz.findMany.mockResolvedValue([]);
      conflictEngine.checkSessionAssembly.mockResolvedValue({
        hard: [{ type: 'STUDENT_OVERLAP', message: 'conflict' }],
        warnings: [],
      });

      await expect(
        service.reschedule('s1', { session_date: '2026-06-01', start_time: '09:00', end_time: '10:00' }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.__tx.examSession.update).not.toHaveBeenCalled();
    });

    it('reschedules successfully when the conflict engine passes', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      const result = await service.reschedule(
        's1',
        { session_date: '2026-06-01', start_time: '09:00', end_time: '10:00' },
        admin,
      );

      expect(result.version).toBe(2);
      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(expect.anything(), prisma.__tx);
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'ExamSession' }),
        expect.anything(),
      );
    });

    it('fans out EXAM_SESSION_RESCHEDULED notifications to every currently-ASSIGNED student, in the SAME transaction (BR-042)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });
      prisma.__tx.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }, { studentId: 'stu-2' }]);
      prisma.__tx.student.findMany.mockResolvedValue([
        { userId: 'user-stu-1' },
        { userId: 'user-stu-2' },
      ]);

      await service.reschedule(
        's1',
        { session_date: '2026-06-01', start_time: '09:00', end_time: '10:00' },
        admin,
      );

      expect(notificationsOutbox.queue).toHaveBeenCalledTimes(2);
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ eventType: 'EXAM_SESSION_RESCHEDULED', recipientId: 'user-stu-1' }),
      );
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ eventType: 'EXAM_SESSION_RESCHEDULED', recipientId: 'user-stu-2' }),
      );
    });
  });

  describe('cancel — reason required, releases all active attachments (ADR-006)', () => {
    const draftSession = { id: 's1', status: ExamSessionStatus.DRAFT };

    it('rejects cancelling an already-CANCELLED session with 409', async () => {
      prisma.examSession.findUnique.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED });

      await expect(service.cancel('s1', { reason: 'x' }, admin)).rejects.toThrow(ConflictException);
    });

    it('rejects cancelling a COMPLETED session with 409', async () => {
      prisma.examSession.findUnique.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.COMPLETED });

      await expect(service.cancel('s1', { reason: 'x' }, admin)).rejects.toThrow(ConflictException);
    });

    it('cancels a DRAFT session, releasing all its active quiz attachments in the same transaction', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });

      const result = await service.cancel('s1', { reason: 'Room unavailable' }, admin);

      expect(result.status).toBe(ExamSessionStatus.CANCELLED);
      expect(prisma.__tx.examSessionQuiz.updateMany).toHaveBeenCalledWith({
        where: { examSessionId: 's1', isActiveAttachment: true },
        data: { isActiveAttachment: false, detachedAt: expect.any(Date) },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE', entityType: 'ExamSession', reason: 'Room unavailable' }),
        expect.anything(),
      );
    });

    it('fans out EXAM_SESSION_CANCELLED notifications to every currently-ASSIGNED student, in the SAME transaction (BR-042)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }]);
      prisma.__tx.student.findMany.mockResolvedValue([{ userId: 'user-stu-1' }]);

      await service.cancel('s1', { reason: 'Room unavailable' }, admin);

      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({
          eventType: 'EXAM_SESSION_CANCELLED',
          recipientId: 'user-stu-1',
          payload: expect.objectContaining({ reason: 'Room unavailable' }),
        }),
      );
    });

    it('queues no notifications when no student is currently ASSIGNED (e.g. cancelling a still-DRAFT session)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.quizStudentAssignment.findMany.mockResolvedValue([]);

      await service.cancel('s1', { reason: 'x' }, admin);

      expect(notificationsOutbox.queue).not.toHaveBeenCalled();
    });
  });

  describe('getConflicts — ADMIN dry-run, no commit', () => {
    it('returns the conflict engine result for the session\'s current state', async () => {
      const session = {
        id: 's1',
        sessionDate: new Date('2026-05-01'),
        startTime: new Date('1970-01-01T10:00:00Z'),
        endTime: new Date('1970-01-01T11:00:00Z'),
      };
      prisma.examSession.findUnique.mockResolvedValue(session);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-1' }]);

      const result = await service.getConflicts('s1');

      expect(result).toEqual({ hard: [], warnings: [] });
      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(
        expect.objectContaining({ examSessionId: 's1', quizIds: ['quiz-1'] }),
      );
      // Never mutates anything — this is a dry-run.
      expect(prisma.examSession.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
