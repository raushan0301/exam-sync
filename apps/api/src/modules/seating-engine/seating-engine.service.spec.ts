import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, Prisma, SeatingPlanStatus } from '@exam-sync/db';
import { SeatingEngineService } from './seating-engine.service';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { QuizzesService } from '../quiz';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

function buildPrismaMock() {
  const tx = {
    seatingPlan: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    seatingAssignment: { createMany: jest.fn(), findMany: jest.fn() },
  };
  return {
    examSessionRoom: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    examSessionRoomQuiz: { findMany: jest.fn() },
    quizStudentAssignment: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
    roomSeat: { findMany: jest.fn() },
    room: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'room-1', building: 'B', roomNumber: '201' }) },
    seatingPlan: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    seatingAssignment: { findMany: jest.fn() },
    examSession: { updateMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('SeatingEngineService — Phase 13 (generation/validation NestJS wiring)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let examSessionsService: { findById: jest.Mock; findByIdScoped: jest.Mock; maybeAdvanceToReadyForFinalization: jest.Mock };
  let quizzesService: { findById: jest.Mock };
  let notificationsOutbox: { queue: jest.Mock };
  let examSessionOwnershipService: { isOwnerOrCoInstructor: jest.Mock };
  let service: SeatingEngineService;

  const sessionInProgress = { id: 's1', status: ExamSessionStatus.SEATING_GENERATION };

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    examSessionsService = {
      findById: jest.fn(),
      findByIdScoped: jest.fn(),
      maybeAdvanceToReadyForFinalization: jest.fn(),
    };
    quizzesService = { findById: jest.fn() };
    notificationsOutbox = { queue: jest.fn() };
    examSessionOwnershipService = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };

    service = new SeatingEngineService(
      prisma,
      auditHook as unknown as AuditHookService,
      examSessionsService as unknown as ExamSessionsService,
      quizzesService as unknown as QuizzesService,
      notificationsOutbox as unknown as NotificationsOutboxService,
      examSessionOwnershipService as unknown as ExamSessionOwnershipService,
    );
  });

  it('generate: 404s a faculty who owns/co-instructs none of the session\'s attached quizzes — faculty-lifecycle-ownership gate', async () => {
    examSessionsService.findById.mockResolvedValue(sessionInProgress);
    prisma.seatingPlan.findFirst.mockResolvedValue(null);
    examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

    await expect(
      service.generate('s1', { room_id: 'room-1', strategy: 'RANDOM' } as any, admin),
    ).rejects.toThrow(NotFoundException);
  });

  it('finalize: 404s a faculty who owns/co-instructs none of the plan\'s exam session', async () => {
    prisma.seatingPlan.findUnique.mockResolvedValue({
      id: 'plan-1',
      examSessionId: 's1',
      status: SeatingPlanStatus.VALIDATED,
    });
    examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

    await expect(service.finalize('plan-1', admin)).rejects.toThrow(NotFoundException);
    expect(examSessionOwnershipService.isOwnerOrCoInstructor).toHaveBeenCalledWith('s1', admin);
  });

  /** A single room, single quiz, 2 students, 2 seats — the minimal happy-path cohort. */
  function mockSimpleCohort() {
    prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1', roomId: 'room-1', examSessionId: 's1' });
    prisma.seatingPlan.findFirst.mockResolvedValue(null);
    prisma.examSessionRoomQuiz.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.examSessionRoomId === 'esr-1'
          ? [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 2 }]
          : [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 2, examSessionRoom: { id: 'esr-1', createdAt: new Date('2026-01-01') } }],
      ),
    );
    prisma.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }, { studentId: 'stu-2' }]);
    quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1' });
    prisma.student.findMany.mockResolvedValue([
      { id: 'stu-1', batchId: 'batch-A' },
      { id: 'stu-2', batchId: 'batch-A' },
    ]);
    prisma.roomSeat.findMany.mockResolvedValue([
      { id: 'seat-1', rowIndex: 0, colIndex: 0, isActive: true, isAccessible: false },
      { id: 'seat-2', rowIndex: 0, colIndex: 1, isActive: true, isAccessible: false },
    ]);
  }

  describe('generate — preconditions', () => {
    it('rejects a session not in SEATING_GENERATION', async () => {
      examSessionsService.findById.mockResolvedValue({ ...sessionInProgress, status: ExamSessionStatus.ASSIGNING_STUDENTS });

      await expect(
        service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('404s when the room is not allocated to this session', async () => {
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.examSessionRoom.findUnique.mockResolvedValue(null);

      await expect(
        service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generate — EC-032 idempotency: an existing DRAFT/VALIDATED/FINALIZED plan short-circuits regeneration', () => {
    it('returns the existing plan\'s summary without creating a new one', async () => {
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1', roomId: 'room-1', examSessionId: 's1' });
      prisma.seatingPlan.findFirst.mockResolvedValue({
        id: 'plan-existing', status: SeatingPlanStatus.VALIDATED, softConstraintScore: null, violationReport: [],
      });

      const result = await service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin);

      expect(result.seating_plan_id).toBe('plan-existing');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('generate — successful generation', () => {
    it('creates a VALIDATED plan with persisted assignments for a fully-seatable cohort', async () => {
      mockSimpleCohort();
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
        { seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
      ]);
      prisma.__tx.seatingPlan.update.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.VALIDATED, softConstraintScore: 1 });
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]); // VALIDATED/FINALIZED plans

      const result = await service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin);

      expect(result.status).toBe(SeatingPlanStatus.VALIDATED);
      expect(prisma.__tx.seatingAssignment.createMany).toHaveBeenCalledWith({
        data: [
          { seatingPlanId: 'plan-1', seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
          { seatingPlanId: 'plan-1', seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
        ],
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'SeatingPlan' }),
        expect.anything(),
      );
    });

    it('ANTI_CHEATING: includes the FR-034 disclaimer in the response', async () => {
      mockSimpleCohort();
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT, strategy: 'ANTI_CHEATING' });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
        { seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
      ]);
      prisma.__tx.seatingPlan.update.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.VALIDATED, strategy: 'ANTI_CHEATING' });
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

      const result = await service.generate('s1', { room_id: 'room-1', strategy: 'ANTI_CHEATING' }, admin);

      expect(result.disclaimer).toContain('reduce opportunistic copying risk');
    });

    it('a non-ANTI_CHEATING strategy never includes the disclaimer', async () => {
      mockSimpleCohort();
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT, strategy: 'SEQUENTIAL' });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
        { seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
      ]);
      prisma.__tx.seatingPlan.update.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.VALIDATED, strategy: 'SEQUENTIAL' });
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

      const result = await service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin);

      expect(result.disclaimer).toBeUndefined();
    });

    it('ANTI_CHEATING single-subject cohort (this fixture\'s only quiz) surfaces fallback_reason', async () => {
      mockSimpleCohort(); // 1 quiz -> 1 subject -> the fallback chain WILL fire
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT, strategy: 'ANTI_CHEATING' });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
        { seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
      ]);
      prisma.__tx.seatingPlan.update.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.VALIDATED, strategy: 'ANTI_CHEATING' });
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

      const result = await service.generate('s1', { room_id: 'room-1', strategy: 'ANTI_CHEATING' }, admin);

      expect(result.fallback_reason).toBeDefined();
      // Persisted alongside the soft violations in the SAME existing column — no new schema.
      expect(prisma.__tx.seatingPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            violationReport: expect.arrayContaining([expect.objectContaining({ type: 'SINGLE_SUBJECT_FALLBACK' })]),
          }),
        }),
      );
    });

    it('a strategy other than ANTI_CHEATING never surfaces a fallback_reason', async () => {
      mockSimpleCohort();
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT, strategy: 'SEQUENTIAL' });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
        { seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
      ]);
      prisma.__tx.seatingPlan.update.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.VALIDATED, strategy: 'SEQUENTIAL' });
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

      const result = await service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin);

      expect(result.fallback_reason).toBeUndefined();
    });

    it("asks ExamSessionsService to check whether the session is now ready to finalize — that service owns the actual ALL-rooms/invigilator readiness decision (see its own maybeAdvanceToReadyForFinalization spec)", async () => {
      mockSimpleCohort();
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
        { seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
      ]);
      prisma.__tx.seatingPlan.update.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.VALIDATED });

      await service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin);

      expect(examSessionsService.maybeAdvanceToReadyForFinalization).toHaveBeenCalledWith('s1');
    });
  });

  describe('generate — HARD violation produces a FAILED plan, not an HTTP error', () => {
    it('marks the plan FAILED when the cohort cannot be fully seated (fewer active seats than students)', async () => {
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1', roomId: 'room-1', examSessionId: 's1' });
      prisma.seatingPlan.findFirst.mockResolvedValue(null);
      prisma.examSessionRoomQuiz.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.examSessionRoomId === 'esr-1'
            ? [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 2 }]
            : [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 2, examSessionRoom: { id: 'esr-1', createdAt: new Date() } }],
        ),
      );
      prisma.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }, { studentId: 'stu-2' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1' });
      prisma.student.findMany.mockResolvedValue([{ id: 'stu-1', batchId: 'A' }, { id: 'stu-2', batchId: 'A' }]);
      prisma.roomSeat.findMany.mockResolvedValue([{ id: 'seat-1', rowIndex: 0, colIndex: 0, isActive: true, isAccessible: false }]); // only 1 seat for 2 students

      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' }, // stu-2 never got a seat
      ]);
      prisma.__tx.seatingPlan.update.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.FAILED });

      const result = await service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin);

      expect(result.status).toBe(SeatingPlanStatus.FAILED);
      expect(result.hard_violations.length).toBeGreaterThan(0);
      expect(prisma.examSession.updateMany).not.toHaveBeenCalled(); // FAILED plans never advance the session
    });
  });

  describe('generate — maps the partial-index race (P2002) to a clean 409', () => {
    it('translates a concurrent duplicate-generation race into ConflictException', async () => {
      mockSimpleCohort();
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.$transaction.mockRejectedValue(p2002());

      await expect(
        service.generate('s1', { room_id: 'room-1', strategy: 'SEQUENTIAL' }, admin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('regenerate — change strategy before finalizing', () => {
    it('marks the current plan SUPERSEDED and creates a fresh plan with the new strategy', async () => {
      mockSimpleCohort();
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.seatingPlan.findFirst.mockResolvedValue({
        id: 'plan-old', status: SeatingPlanStatus.VALIDATED, strategy: 'SEQUENTIAL',
      });
      prisma.__tx.seatingPlan.update
        .mockResolvedValueOnce({ id: 'plan-old', status: SeatingPlanStatus.SUPERSEDED })
        .mockResolvedValueOnce({ id: 'plan-new', status: SeatingPlanStatus.VALIDATED, strategy: 'RANDOMIZED', softConstraintScore: 1 });
      prisma.__tx.seatingPlan.create.mockResolvedValue({ id: 'plan-new', status: SeatingPlanStatus.DRAFT });
      prisma.__tx.seatingAssignment.findMany.mockResolvedValue([
        { seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' },
        { seatId: 'seat-2', studentId: 'stu-2', quizId: 'quiz-1' },
      ]);
      prisma.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
      prisma.seatingPlan.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

      const result = await service.regenerate('s1', { room_id: 'room-1', strategy: 'RANDOMIZED' }, admin);

      expect(prisma.__tx.seatingPlan.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'plan-old' },
        data: { status: SeatingPlanStatus.SUPERSEDED, version: { increment: 1 } },
      });
      expect(result.seating_plan_id).toBe('plan-new');
      expect(result.status).toBe(SeatingPlanStatus.VALIDATED);
    });

    it('409s if the room\'s plan is already FINALIZED', async () => {
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1', roomId: 'room-1', examSessionId: 's1' });
      prisma.seatingPlan.findFirst.mockResolvedValue({ id: 'plan-old', status: SeatingPlanStatus.FINALIZED });

      await expect(
        service.regenerate('s1', { room_id: 'room-1', strategy: 'RANDOMIZED' }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('409s if no seating plan exists yet for this room', async () => {
      examSessionsService.findById.mockResolvedValue(sessionInProgress);
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1', roomId: 'room-1', examSessionId: 's1' });
      prisma.seatingPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.regenerate('s1', { room_id: 'room-1', strategy: 'RANDOMIZED' }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates the 404 a non-owning faculty member would get (IDOR-safe)', async () => {
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);
      examSessionsService.findById.mockResolvedValue(sessionInProgress);

      await expect(
        service.regenerate('s1', { room_id: 'room-1', strategy: 'RANDOMIZED' }, admin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('finalize', () => {
    it('404s for a non-existent plan', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue(null);
      await expect(service.finalize('missing', admin)).rejects.toThrow(NotFoundException);
    });

    it('rejects finalizing a plan not in VALIDATED status', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({ id: 'plan-1', status: SeatingPlanStatus.DRAFT });
      await expect(service.finalize('plan-1', admin)).rejects.toThrow(ConflictException);
    });

    it('re-validates fresh and FINALIZES when there are still zero hard violations', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({
        id: 'plan-1', status: SeatingPlanStatus.VALIDATED, examSessionId: 's1', roomId: 'room-1',
      });
      prisma.examSessionRoom.findUniqueOrThrow.mockResolvedValue({ id: 'esr-1' });
      prisma.examSessionRoomQuiz.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.examSessionRoomId === 'esr-1'
            ? [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 1 }]
            : [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 1, examSessionRoom: { id: 'esr-1', createdAt: new Date() } }],
        ),
      );
      prisma.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1' });
      prisma.student.findMany.mockResolvedValue([{ id: 'stu-1', batchId: 'A' }]);
      prisma.roomSeat.findMany.mockResolvedValue([{ id: 'seat-1', rowIndex: 0, colIndex: 0, isActive: true, isAccessible: false }]);
      prisma.seatingAssignment.findMany.mockResolvedValue([{ seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' }]);
      const finalized = { id: 'plan-1', status: SeatingPlanStatus.FINALIZED, examSessionId: 's1', finalizedAt: new Date() };
      prisma.__tx.seatingPlan.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.__tx.seatingPlan.findUniqueOrThrow = jest.fn().mockResolvedValue(finalized);
      prisma.roomSeat.findMany.mockResolvedValueOnce([{ id: 'seat-1', rowIndex: 0, colIndex: 0, isActive: true, isAccessible: false }]);
      prisma.roomSeat.findMany.mockResolvedValueOnce([{ id: 'seat-1', seatLabel: 'R1C1' }]);
      prisma.student.findMany.mockResolvedValueOnce([{ id: 'stu-1', batchId: 'A' }]);
      prisma.student.findMany.mockResolvedValueOnce([{ id: 'stu-1', userId: 'user-stu-1' }]);

      const result = await service.finalize('plan-1', admin);

      expect(result.status).toBe(SeatingPlanStatus.FINALIZED);
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ eventType: 'SEAT_ASSIGNED', recipientId: 'user-stu-1' }),
      );
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'SeatingPlan' }),
        expect.anything(),
      );
    });

    it('rejects finalize with 409 and does NOT change status when a fresh re-validation now finds a hard violation (ADR-004: never trust stale VALIDATED)', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({
        id: 'plan-1', status: SeatingPlanStatus.VALIDATED, examSessionId: 's1', roomId: 'room-1',
      });
      prisma.examSessionRoom.findUniqueOrThrow.mockResolvedValue({ id: 'esr-1' });
      prisma.examSessionRoomQuiz.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.examSessionRoomId === 'esr-1'
            ? [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 1 }]
            : [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 1, examSessionRoom: { id: 'esr-1', createdAt: new Date() } }],
        ),
      );
      prisma.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1' });
      prisma.student.findMany.mockResolvedValue([{ id: 'stu-1', batchId: 'A' }]);
      // Seat got disabled since generation (EC-048-style drift) — now INACTIVE_SEAT.
      prisma.roomSeat.findMany.mockResolvedValue([{ id: 'seat-1', rowIndex: 0, colIndex: 0, isActive: false, isAccessible: false }]);
      prisma.seatingAssignment.findMany.mockResolvedValue([{ seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' }]);
      prisma.__tx.seatingPlan.updateMany = jest.fn();

      await expect(service.finalize('plan-1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.__tx.seatingPlan.updateMany).not.toHaveBeenCalled();
      expect(notificationsOutbox.queue).not.toHaveBeenCalled();
    });

    it('409s cleanly instead of double-finalizing when a concurrent finalize already flipped the plan out of VALIDATED (race guard)', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({
        id: 'plan-1', status: SeatingPlanStatus.VALIDATED, examSessionId: 's1', roomId: 'room-1',
      });
      prisma.examSessionRoom.findUniqueOrThrow.mockResolvedValue({ id: 'esr-1' });
      prisma.examSessionRoomQuiz.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.examSessionRoomId === 'esr-1'
            ? [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 1 }]
            : [{ examSessionRoomId: 'esr-1', quizId: 'quiz-1', studentCount: 1, examSessionRoom: { id: 'esr-1', createdAt: new Date() } }],
        ),
      );
      prisma.quizStudentAssignment.findMany.mockResolvedValue([{ studentId: 'stu-1' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1' });
      prisma.student.findMany.mockResolvedValue([{ id: 'stu-1', batchId: 'A' }]);
      prisma.roomSeat.findMany.mockResolvedValue([{ id: 'seat-1', rowIndex: 0, colIndex: 0, isActive: true, isAccessible: false }]);
      prisma.seatingAssignment.findMany.mockResolvedValue([{ seatId: 'seat-1', studentId: 'stu-1', quizId: 'quiz-1' }]);
      // Another transaction already won the race and flipped the row to
      // FINALIZED — this transaction's conditional updateMany matches 0 rows.
      prisma.__tx.seatingPlan.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await expect(service.finalize('plan-1', admin)).rejects.toThrow(ConflictException);
      expect(notificationsOutbox.queue).not.toHaveBeenCalled();
    });
  });

  describe('findByIdScoped', () => {
    it('404s for a non-existent plan', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue(null);
      await expect(service.findByIdScoped('missing', admin)).rejects.toThrow(NotFoundException);
    });

    it('delegates authorization to ExamSessionsService.findByIdScoped', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({ id: 'plan-1', examSessionId: 's1' });
      examSessionsService.findByIdScoped.mockRejectedValue(new NotFoundException());
      prisma.seatingAssignment.findMany.mockResolvedValue([]);

      await expect(service.findByIdScoped('plan-1', admin)).rejects.toThrow(NotFoundException);
      expect(examSessionsService.findByIdScoped).toHaveBeenCalledWith('s1', admin);
    });

    it('returns the plan with its assignments once authorized', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({ id: 'plan-1', examSessionId: 's1' });
      examSessionsService.findByIdScoped.mockResolvedValue({ id: 's1' });
      prisma.seatingAssignment.findMany.mockResolvedValue([{ id: 'a1', seatId: 'seat-1', studentId: 'stu-1' }]);

      const result = await service.findByIdScoped('plan-1', admin);

      expect(result.assignments).toHaveLength(1);
    });
  });

  describe('getJob', () => {
    it('returns the plan\'s status as a job-shaped summary (job_id === plan_id)', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({
        id: 'plan-1', examSessionId: 's1', status: SeatingPlanStatus.VALIDATED, softConstraintScore: 0.75, violationReport: [{ type: 'SUBJECT_ADJACENCY' }],
      });
      examSessionsService.findByIdScoped.mockResolvedValue(sessionInProgress);

      const result = await service.getJob('plan-1', admin);

      expect(result.job_id).toBe('plan-1');
      expect(result.status).toBe(SeatingPlanStatus.VALIDATED);
      expect(result.soft_constraint_score).toBe(0.75);
      expect(result.soft_violations).toEqual([{ type: 'SUBJECT_ADJACENCY' }]);
    });

    it('re-derives the disclaimer and fallback_reason from a PERSISTED ANTI_CHEATING plan (not just the immediate generate() response)', async () => {
      prisma.seatingPlan.findUnique.mockResolvedValue({
        id: 'plan-1',
        examSessionId: 's1',
        status: SeatingPlanStatus.VALIDATED,
        strategy: 'ANTI_CHEATING',
        softConstraintScore: 1,
        violationReport: [
          { type: 'SINGLE_SUBJECT_FALLBACK', fallback_reason: 'SINGLE_SUBJECT_RANDOMIZED', message: 'x', seatIdA: '', seatIdB: '' },
        ],
      });
      examSessionsService.findByIdScoped.mockResolvedValue(sessionInProgress);

      const result = await service.getJob('plan-1', admin);

      expect(result.disclaimer).toContain('reduce opportunistic copying risk');
      expect(result.fallback_reason).toBe('SINGLE_SUBJECT_RANDOMIZED');
      // The synthetic marker itself is not double-counted as a real soft violation.
      expect(result.soft_violations).toEqual([]);
    });

    it('is reachable by the owning/co-instructing FACULTY, not just ADMIN — SeatingPanel.tsx polls this right after that faculty generates seating', async () => {
      const facultyActor: AuthenticatedUser = { id: 'fac-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };
      prisma.seatingPlan.findUnique.mockResolvedValue({
        id: 'plan-1', examSessionId: 's1', status: SeatingPlanStatus.VALIDATED, softConstraintScore: 0.5, violationReport: [],
      });
      examSessionsService.findByIdScoped.mockResolvedValue(sessionInProgress);

      const result = await service.getJob('plan-1', facultyActor);

      expect(examSessionsService.findByIdScoped).toHaveBeenCalledWith('s1', facultyActor);
      expect(result.job_id).toBe('plan-1');
    });

    it('propagates the 404 a non-owning faculty member would get from findByIdScoped (IDOR-safe)', async () => {
      const otherFaculty: AuthenticatedUser = { id: 'fac-2', email: 'f2@example.com', roles: ['FACULTY'], mustChangePassword: false };
      prisma.seatingPlan.findUnique.mockResolvedValue({
        id: 'plan-1', examSessionId: 's1', status: SeatingPlanStatus.VALIDATED, softConstraintScore: 0.5, violationReport: [],
      });
      examSessionsService.findByIdScoped.mockRejectedValue(new NotFoundException());

      await expect(service.getJob('plan-1', otherFaculty)).rejects.toThrow(NotFoundException);
    });
  });
});
