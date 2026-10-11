import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, Prisma, QuizStatus, SeatingPlanStatus } from '@exam-sync/db';
import { ExamSessionsService } from './exam-sessions.service';
import { ConflictEngineService } from '../conflict-engine';
import { QuizzesService, QuizOwnershipService } from '../quiz';
import { FacultyService } from '../faculty';
import { ExamSessionsAccessRepository } from './exam-sessions-access.repository';
import { ExamSessionOwnershipService } from './exam-session-ownership.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { RoomHoldsService } from '../../common/room-holds/room-holds.service';

function buildPrismaMock() {
  const tx = {
    examSessionQuiz: { update: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    examSessionRoomRequest: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    examSession: { create: jest.fn(), update: jest.fn() },
    quizStudentAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    student: { findMany: jest.fn().mockResolvedValue([]) },
    examSessionRoom: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    examSessionRoomQuiz: { deleteMany: jest.fn() },
    examInvigilator: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    seatingPlan: { updateMany: jest.fn() },
  };
  return {
    examSession: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    examSessionQuiz: { findMany: jest.fn(), findFirst: jest.fn() },
    examSessionRoom: { findMany: jest.fn() },
    seatingPlan: { findMany: jest.fn() },
    examInvigilator: { findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

// `admin` is kept only for the read-only/getConflicts describe block below —
// every MUTATING method (attach/detach, reschedule, cancel) is FACULTY-only
// at the controller (`@Roles(ROLE.FACULTY)`, see exam-sessions.controller.ts)
// since the faculty-lifecycle-ownership change; this service layer doesn't
// re-check the role itself (that's RolesGuard's job, see roles.guard.spec.ts),
// so `admin` here just stands in for "some authenticated actor" in tests that
// predate that change and never exercised role-checking logic. The
// ownership-mock defaults to `true` in `beforeEach` below so those pre-existing
// tests keep testing what they always tested; ownership-DENIAL is its own
// dedicated describe block further down.
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };
const faculty: AuthenticatedUser = { id: 'faculty-user-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };

describe('ExamSessionsService (create, attach/detach, reschedule, cancel — conflictEngine mocked; real Conflict Engine has its own spec)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let conflictEngine: { checkSessionAssembly: jest.Mock };
  let quizzesService: { findById: jest.Mock };
  let accessRepository: { findScoped: jest.Mock };
  let notificationsOutbox: { queue: jest.Mock };
  let examSessionOwnershipService: { isOwnerOrCoInstructor: jest.Mock };
  let quizOwnershipService: { isOwnerOrCoInstructor: jest.Mock };
  let facultyService: { findByUserId: jest.Mock };
  let roomHolds: { activeHoldsForQuiz: jest.Mock; releaseForQuizzes: jest.Mock; releaseForRequest: jest.Mock };
  let service: ExamSessionsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    conflictEngine = { checkSessionAssembly: jest.fn().mockResolvedValue({ hard: [], warnings: [] }) };
    quizzesService = { findById: jest.fn() };
    accessRepository = { findScoped: jest.fn() };
    notificationsOutbox = { queue: jest.fn() };
    // Ownership defaults to `true`/`true` so every test written BEFORE the
    // faculty-lifecycle-ownership change keeps exercising exactly what it
    // always exercised; ownership-DENIAL gets its own describe block below.
    examSessionOwnershipService = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };
    quizOwnershipService = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };
    facultyService = { findByUserId: jest.fn().mockResolvedValue({ id: 'faculty-1' }) };
    roomHolds = { activeHoldsForQuiz: jest.fn().mockResolvedValue([]), releaseForQuizzes: jest.fn().mockResolvedValue([]), releaseForRequest: jest.fn() };

    service = new ExamSessionsService(
      prisma,
      auditHook as unknown as AuditHookService,
      conflictEngine as unknown as ConflictEngineService,
      quizzesService as unknown as QuizzesService,
      accessRepository as unknown as ExamSessionsAccessRepository,
      notificationsOutbox as unknown as NotificationsOutboxService,
      examSessionOwnershipService as unknown as ExamSessionOwnershipService,
      quizOwnershipService as unknown as QuizOwnershipService,
      facultyService as unknown as FacultyService,
      roomHolds as unknown as RoomHoldsService,
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
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.DRAFT });

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
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.APPROVED });
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
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.APPROVED });
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

    describe('held rooms vs the session\'s slot', () => {
      const attach = async (hold: { holdDate: Date; startTime: Date; endTime: Date }) => {
        prisma.examSession.findUnique.mockResolvedValue(draftSession);
        prisma.examSessionQuiz.findMany.mockResolvedValue([]);
        quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.APPROVED });
        prisma.examSessionQuiz.findFirst.mockResolvedValue(null);
        prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });
        roomHolds.activeHoldsForQuiz.mockResolvedValue([hold]);
        await service.attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, admin);
      };

      it('releases the quiz\'s held rooms (and tells its faculty) when the session is at a DIFFERENT date or time', async () => {
        await attach({ holdDate: new Date('2026-05-02'), startTime: draftSession.startTime, endTime: draftSession.endTime });
        expect(roomHolds.releaseForQuizzes).toHaveBeenCalledWith(prisma.__tx, ['quiz-1'], 'TIME_CHANGED', { notify: true });
      });

      it('keeps the holds when the session is at exactly the approved slot', async () => {
        await attach({ holdDate: draftSession.sessionDate, startTime: draftSession.startTime, endTime: draftSession.endTime });
        expect(roomHolds.releaseForQuizzes).toHaveBeenCalledWith(prisma.__tx, [], 'TIME_CHANGED', { notify: true });
      });
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
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.APPROVED });
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
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.APPROVED });
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
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.APPROVED });
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

  describe('reschedule — invigilators are told the new time too', () => {
    const draftSession = { id: 's1', status: ExamSessionStatus.DRAFT, sessionDate: new Date('2026-05-01'), startTime: new Date('1970-01-01T09:00:00Z'), endTime: new Date('1970-01-01T10:00:00Z') };
    it('sends ONE message per invigilator listing every room they cover, in the same transaction', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, name: 'Finals', version: 3 });
      prisma.__tx.quizStudentAssignment.findMany.mockResolvedValue([]);
      prisma.__tx.student.findMany.mockResolvedValue([]);
      prisma.__tx.examInvigilator.findMany.mockResolvedValue([
        { faculty: { userId: 'user-fac-1' }, room: { building: 'B', roomNumber: '107' } },
        { faculty: { userId: 'user-fac-1' }, room: { building: 'B', roomNumber: '108' } },
        { faculty: { userId: 'user-fac-2' }, room: { building: 'B', roomNumber: '107' } },
      ]);

      await service.reschedule('s1', { session_date: '2026-06-01', start_time: '09:00', end_time: '10:00' }, admin);

      expect(notificationsOutbox.queue).toHaveBeenCalledTimes(2);
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({
          recipientType: 'FACULTY',
          recipientId: 'user-fac-1',
          eventType: 'EXAM_SESSION_RESCHEDULED',
          payload: expect.objectContaining({ as_invigilator: true, room_label: 'B-107, B-108', session_date: '2026-06-01', start_time: '09:00', end_time: '10:00' }),
        }),
      );
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ recipientId: 'user-fac-2', payload: expect.objectContaining({ room_label: 'B-107' }) }),
      );
    });
  });

  describe('cancelSession — reason required, releases all active attachments (ADR-006)', () => {
    const draftSession = { id: 's1', status: ExamSessionStatus.DRAFT };

    it('rejects cancelling an already-CANCELLED session with 409', async () => {
      prisma.examSession.findUnique.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED });

      await expect(service.cancelSession('s1', 'x', admin)).rejects.toThrow(ConflictException);
    });

    it('rejects cancelling a COMPLETED session with 409', async () => {
      prisma.examSession.findUnique.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.COMPLETED });

      await expect(service.cancelSession('s1', 'x', admin)).rejects.toThrow(ConflictException);
    });

    it('cancels a DRAFT session, releasing all its active quiz attachments in the same transaction', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });

      const result = await service.cancelSession('s1', 'Room unavailable', admin);

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

    it('releases every room already allocated to this session, so the room/time window is free for a future session (BR-018 EXCLUDE constraint has no visibility into session status)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.examSessionRoom.findMany.mockResolvedValue([{ id: 'esr-1' }, { id: 'esr-2' }]);

      await service.cancelSession('s1', 'Room unavailable', admin);

      expect(prisma.__tx.examSessionRoomQuiz.deleteMany).toHaveBeenCalledWith({
        where: { examSessionRoomId: { in: ['esr-1', 'esr-2'] } },
      });
      expect(prisma.__tx.examSessionRoom.deleteMany).toHaveBeenCalledWith({ where: { examSessionId: 's1' } });
    });

    it('skips the room-release deletes entirely when no room was ever allocated', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.examSessionRoom.findMany.mockResolvedValue([]);

      await service.cancelSession('s1', 'Room unavailable', admin);

      expect(prisma.__tx.examSessionRoomQuiz.deleteMany).not.toHaveBeenCalled();
      expect(prisma.__tx.examSessionRoom.deleteMany).not.toHaveBeenCalled();
    });

    it('releases every invigilator assignment and supersedes every non-superseded seating plan for the cancelled session — same "stop looking active" treatment as rooms', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });

      await service.cancelSession('s1', 'Room unavailable', admin);

      expect(prisma.__tx.examInvigilator.deleteMany).toHaveBeenCalledWith({ where: { examSessionId: 's1' } });
      expect(prisma.__tx.seatingPlan.updateMany).toHaveBeenCalledWith({
        where: { examSessionId: 's1', status: { notIn: [SeatingPlanStatus.SUPERSEDED] } },
        data: { status: SeatingPlanStatus.SUPERSEDED, version: { increment: 1 } },
      });
    });

    it('tells every invigilator their duty is cancelled with the session (read before the rows are deleted), in the SAME transaction', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, name: 'Finals', status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.examInvigilator.findMany.mockResolvedValue([
        { id: 'inv-1', faculty: { userId: 'user-fac-1' }, room: { building: 'B', roomNumber: '107' } },
        { id: 'inv-2', faculty: { userId: 'user-fac-2' }, room: { building: 'B', roomNumber: '108' } },
      ]);

      await service.cancelSession('s1', 'Venue unavailable', admin);

      const order = [
        prisma.__tx.examInvigilator.findMany.mock.invocationCallOrder[0],
        prisma.__tx.examInvigilator.deleteMany.mock.invocationCallOrder[0],
      ];
      expect(order[0]).toBeLessThan(order[1]); // fetched before deleted
      const invigilatorNotes = notificationsOutbox.queue.mock.calls.filter((c: any[]) => c[1].eventType === 'INVIGILATOR_REMOVED');
      expect(invigilatorNotes).toHaveLength(2);
      expect(invigilatorNotes[0][0]).toBe(prisma.__tx);
      expect(invigilatorNotes[0][1]).toMatchObject({
        recipientType: 'FACULTY',
        recipientId: 'user-fac-1',
        entityId: 'inv-1',
        payload: { session_name: 'Finals', room_label: 'B-107', cause: 'SESSION_CANCELLED', reason: 'Venue unavailable' },
      });
      expect(invigilatorNotes[1][1].recipientId).toBe('user-fac-2');
    });

    it('releases the seats still held for the session\'s quizzes (not yet allocated), reason SESSION_CANCELLED, without a second notification', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'q-a' }, { quizId: 'q-b' }]);

      await service.cancelSession('s1', 'Venue unavailable', admin);

      expect(roomHolds.releaseForQuizzes).toHaveBeenCalledWith(prisma.__tx, ['q-a', 'q-b'], 'SESSION_CANCELLED', { notify: false });
    });

    it('withdraws a waiting "more rooms" request with the session and frees the rooms it had locked', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.examSessionRoomRequest.findMany.mockResolvedValue([{ id: 'req-1' }]);

      await service.cancelSession('s1', 'Venue unavailable', admin);

      expect(roomHolds.releaseForRequest).toHaveBeenCalledWith(prisma.__tx, 'req-1', 'SESSION_CANCELLED');
      expect(prisma.__tx.examSessionRoomRequest.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['req-1'] } }, data: { status: 'CANCELLED' } });
    });

    it('fans out EXAM_SESSION_CANCELLED notifications to every currently-ASSIGNED student, in the SAME transaction (BR-042)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }]);
      prisma.__tx.student.findMany.mockResolvedValue([{ userId: 'user-stu-1' }]);

      await service.cancelSession('s1', 'Room unavailable', admin);

      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({
          eventType: 'EXAM_SESSION_CANCELLED',
          recipientId: 'user-stu-1',
          payload: expect.objectContaining({ reason: 'Room unavailable' }),
        }),
      );
    });

    it('runs the caller\'s hook INSIDE the cancellation transaction, after the status change', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      const hook = jest.fn().mockResolvedValue(undefined);

      await service.cancelSession('s1', 'Venue flooded', admin, hook);

      expect(hook).toHaveBeenCalledWith(prisma.__tx);
      expect(prisma.__tx.examSession.update.mock.invocationCallOrder[0]).toBeLessThan(hook.mock.invocationCallOrder[0]);
    });

    it('runs in a transaction with a generous explicit time limit — it measured 2.4-3.2 s live, too close to Prisma\'s 5 s default', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });

      await service.cancelSession('s1', 'x', admin);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 30_000 });
    });

    it('a failing hook aborts the whole cancellation (the transaction rejects)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });

      await expect(
        service.cancelSession('s1', 'x', admin, async () => {
          throw new ConflictException('already reviewed');
        }),
      ).rejects.toThrow('already reviewed');
    });

    it('does NOT check ownership — admin approval is what authorises it (faculty request via the suspension service)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });

      await service.cancelSession('s1', 'x', admin);

      expect(examSessionOwnershipService.isOwnerOrCoInstructor).not.toHaveBeenCalled();
    });

    it('queues no notifications when no student is currently ASSIGNED (e.g. cancelling a still-DRAFT session)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED, version: 2 });
      prisma.__tx.quizStudentAssignment.findMany.mockResolvedValue([]);

      await service.cancelSession('s1', 'x', admin);

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
      accessRepository.findScoped.mockResolvedValue(session);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-1' }]);

      const result = await service.getConflicts('s1', admin);

      expect(result).toEqual({ hard: [], warnings: [] });
      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(
        expect.objectContaining({ examSessionId: 's1', quizIds: ['quiz-1'] }),
      );
      // Never mutates anything — this is a dry-run.
      expect(prisma.examSession.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('faculty-lifecycle-ownership: stakeholder/owner gating', () => {
    const draftSession = {
      id: 's1',
      status: ExamSessionStatus.DRAFT,
      sessionDate: new Date('2026-05-01'),
      startTime: new Date('1970-01-01T10:00:00Z'),
      endTime: new Date('1970-01-01T11:00:00Z'),
    };

    it('attachAndDetachQuizzes: 404s a non-stakeholder faculty when the session already has active attachments (cannot piggyback onto someone else\'s session)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'someone-elses-quiz' }]);
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(
        service.attachAndDetachQuizzes('s1', { add: [], remove: [] }, faculty),
      ).rejects.toThrow(NotFoundException);
    });

    it('attachAndDetachQuizzes: allows the FIRST attach on a brand-new session (zero active attachments) with no stakeholder check', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]); // no active attachments yet
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', title: 'Quiz One', status: QuizStatus.APPROVED });
      prisma.examSessionQuiz.findFirst.mockResolvedValue(null);
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftSession, version: 2 });

      await service.attachAndDetachQuizzes('s1', { add: ['quiz-1'], remove: [] }, faculty);

      expect(examSessionOwnershipService.isOwnerOrCoInstructor).not.toHaveBeenCalled();
      expect(quizOwnershipService.isOwnerOrCoInstructor).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'quiz-1' }),
        faculty,
      );
    });

    it('attachAndDetachQuizzes: rejects attaching a quiz the acting faculty does not own/co-instruct, with a specific, actionable message', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-not-mine', title: 'Not My Quiz', status: QuizStatus.APPROVED });
      quizOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      const error = await service
        .attachAndDetachQuizzes('s1', { add: ['quiz-not-mine'], remove: [] }, faculty)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toContain('Not My Quiz');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('reschedule: 404s a faculty who owns/co-instructs none of the session\'s attached quizzes (IDOR-safe, mirrors quizzes.service.ts PATCH)', async () => {
      prisma.examSession.findUnique.mockResolvedValue(draftSession);
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(
        service.reschedule('s1', { session_date: '2026-06-01', start_time: '09:00', end_time: '10:00' }, faculty),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list — GET /exam-sessions (new: admin unscoped, faculty scoped to own/co-instructed)', () => {
    it('ADMIN: returns every session, unscoped, with no ownership lookups at all', async () => {
      prisma.examSession.findMany = jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

      const result = await service.list(admin, {});

      expect(result.items).toEqual([{ id: 's1' }, { id: 's2' }]);
      expect(facultyService.findByUserId).not.toHaveBeenCalled();
    });

    it('FACULTY: returns only sessions where they own/co-instruct at least one active attachment', async () => {
      prisma.examSessionQuiz.findMany.mockResolvedValue([
        { examSessionId: 's1', quiz: { id: 'q1' } },
        { examSessionId: 's2', quiz: { id: 'q2' } },
      ]);
      quizOwnershipService.isOwnerOrCoInstructor
        .mockResolvedValueOnce(true) // q1 -> s1 owned
        .mockResolvedValueOnce(false); // q2 -> s2 not owned
      prisma.examSession.findMany = jest.fn().mockResolvedValue([{ id: 's1' }]);

      const result = await service.list(faculty, {});

      expect(result.items).toEqual([{ id: 's1' }]);
      expect(prisma.examSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['s1'] } } }),
      );
    });

    it('FACULTY with no faculty account at all: returns an empty page rather than erroring', async () => {
      facultyService.findByUserId.mockResolvedValue(null);

      const result = await service.list(faculty, {});

      expect(result.items).toEqual([]);
    });

    it('FACULTY: also sees a session they created even before any quiz is attached (an orphan from a failed first attach)', async () => {
      prisma.examSessionQuiz.findMany.mockResolvedValue([]); // no active attachments anywhere
      prisma.examSession.findMany = jest.fn().mockResolvedValue([{ id: 'orphan-1' }]);

      const result = await service.list(faculty, {});

      expect(result.items).toEqual([{ id: 'orphan-1' }]);
      expect(prisma.examSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdByAdminId: faculty.id }, select: { id: true } }),
      );
    });
  });

  describe('getDetail — seatingReady field (faculty-facing progress stepper)', () => {
    it('is false when the session has no allocated rooms', async () => {
      accessRepository.findScoped.mockResolvedValue({ id: 's1', status: ExamSessionStatus.ASSIGNING_STUDENTS });
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.examSessionRoom.findMany.mockResolvedValue([]);

      const result = await service.getDetail('s1', admin);

      expect(result.seatingReady).toBe(false);
    });

    it('is false when a room has no validated/finalized plan yet', async () => {
      accessRepository.findScoped.mockResolvedValue({ id: 's1', status: ExamSessionStatus.SEATING_GENERATION });
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1', room: { id: 'room-1' }, allocatedCapacity: 30 }]);
      prisma.seatingPlan.findMany.mockResolvedValue([]);

      const result = await service.getDetail('s1', admin);

      expect(result.seatingReady).toBe(false);
    });

    it('is true once every allocated room has a validated or finalized plan', async () => {
      accessRepository.findScoped.mockResolvedValue({ id: 's1', status: ExamSessionStatus.SEATING_GENERATION });
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1', room: { id: 'room-1' }, allocatedCapacity: 30 }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

      const result = await service.getDetail('s1', admin);

      expect(result.seatingReady).toBe(true);
    });
  });

  describe('maybeAdvanceToReadyForFinalization — SEATING_GENERATION -> READY_FOR_FINALIZATION requires EVERY room to have both a validated/finalized plan AND an invigilator', () => {
    it('does nothing when the session has no allocated rooms yet', async () => {
      prisma.examSessionRoom.findMany.mockResolvedValue([]);

      await service.maybeAdvanceToReadyForFinalization('s1');

      expect(prisma.examSession.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT advance when a room has no validated/finalized seating plan yet', async () => {
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([]);

      await service.maybeAdvanceToReadyForFinalization('s1');

      expect(prisma.examSession.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT advance when every room has a plan but NO room has an invigilator assigned yet', async () => {
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.examInvigilator.findMany.mockResolvedValue([]);

      await service.maybeAdvanceToReadyForFinalization('s1');

      expect(prisma.examSession.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT advance when only SOME rooms have an invigilator', async () => {
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }, { roomId: 'room-2' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }, { roomId: 'room-2' }]);
      prisma.examInvigilator.findMany.mockResolvedValue([{ roomId: 'room-1' }]); // room-2 has none

      await service.maybeAdvanceToReadyForFinalization('s1');

      expect(prisma.examSession.updateMany).not.toHaveBeenCalled();
    });

    it('advances to READY_FOR_FINALIZATION once every room has both a validated/finalized plan AND an invigilator', async () => {
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.examInvigilator.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

      await service.maybeAdvanceToReadyForFinalization('s1');

      expect(prisma.examSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: ExamSessionStatus.SEATING_GENERATION },
        data: { status: ExamSessionStatus.READY_FOR_FINALIZATION, version: { increment: 1 } },
      });
    });
  });
});
