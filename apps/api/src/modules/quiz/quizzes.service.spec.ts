import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QuizApprovalAction, QuizStatus } from '@exam-sync/db';
import { QuizzesService } from './quizzes.service';
import { SubjectsService, BatchesService } from '../academic-structure';
import { FacultyService } from '../faculty';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { QuizOwnershipService } from './quiz-ownership.service';
import { QuizAccessRepository } from './quiz-access.repository';
import { QuizApprovalHistoryService } from './quiz-approval-history.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { EnrollmentsService } from '../enrollment';

function buildPrismaMock() {
  const tx = {
    quiz: { create: jest.fn(), update: jest.fn() },
    quizBatch: { createMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return {
    quiz: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    quizBatch: { findMany: jest.fn() },
    facultySubjectBatchAssignment: { findMany: jest.fn() },
    examSessionQuiz: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const facultyActor: AuthenticatedUser = { id: 'user-faculty-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };
const adminActor: AuthenticatedUser = { id: 'user-admin-1', email: 'a@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('QuizzesService — DRAFT/SUBMITTED/APPROVED/REJECTED lifecycle (Phase 6 + 7)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let subjectsService: { findById: jest.Mock };
  let batchesService: { findById: jest.Mock };
  let facultyService: { findByUserId: jest.Mock; findById: jest.Mock };
  let facultyAssignmentsService: { hasActiveAssignment: jest.Mock };
  let ownershipService: { isOwnerOrCoInstructor: jest.Mock };
  let accessRepository: { findScoped: jest.Mock };
  let approvalHistoryService: { record: jest.Mock; listForQuiz: jest.Mock };
  let notificationsOutbox: { queue: jest.Mock };
  let enrollmentsService: { findEligibleStudentIds: jest.Mock };
  let service: QuizzesService;

  const createDto = {
    title: 'DBMS Quiz 1',
    subject_id: 'subject-DBMS',
    batch_ids: ['batch-A'],
    academic_year: '2026',
    semester: 1,
    student_count: 60,
    preferred_date: '2026-05-01',
    preferred_time: '10:00',
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    subjectsService = { findById: jest.fn() };
    batchesService = { findById: jest.fn() };
    facultyService = { findByUserId: jest.fn(), findById: jest.fn() };
    facultyAssignmentsService = { hasActiveAssignment: jest.fn() };
    ownershipService = { isOwnerOrCoInstructor: jest.fn() };
    accessRepository = { findScoped: jest.fn() };
    approvalHistoryService = { record: jest.fn(), listForQuiz: jest.fn() };
    notificationsOutbox = { queue: jest.fn() };
    enrollmentsService = { findEligibleStudentIds: jest.fn() };
    prisma.quizBatch.findMany.mockResolvedValue([]); // default; overridden per-test where batch ids matter
    facultyService.findById.mockResolvedValue({ id: 'faculty-1', userId: 'user-faculty-1' });

    service = new QuizzesService(
      prisma,
      auditHook as unknown as AuditHookService,
      subjectsService as unknown as SubjectsService,
      batchesService as unknown as BatchesService,
      facultyService as unknown as FacultyService,
      facultyAssignmentsService as unknown as FacultyAssignmentsService,
      ownershipService as unknown as QuizOwnershipService,
      accessRepository as unknown as QuizAccessRepository,
      approvalHistoryService as unknown as QuizApprovalHistoryService,
      notificationsOutbox as unknown as NotificationsOutboxService,
      enrollmentsService as unknown as EnrollmentsService,
    );
  });

  describe('getEligibleStudentCount', () => {
    it('returns the real enrolled-eligible count for the given subject/batches/year/semester', async () => {
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['s1', 's2', 's3']);

      const result = await service.getEligibleStudentCount('subject-DBMS', ['batch-A', 'batch-B'], '2026', 1);

      expect(result).toEqual({ count: 3 });
      expect(enrollmentsService.findEligibleStudentIds).toHaveBeenCalledWith('subject-DBMS', ['batch-A', 'batch-B'], '2026', 1);
    });
  });

  describe('create — BR-010', () => {
    it('rejects a non-faculty actor (defense in depth beyond RolesGuard)', async () => {
      facultyService.findByUserId.mockResolvedValue(null);
      await expect(service.create(createDto, facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the subject does not exist', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockRejectedValue(new NotFoundException());
      await expect(service.create(createDto, facultyActor)).rejects.toThrow(NotFoundException);
    });

    it('rejects when a target batch does not exist', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockRejectedValue(new NotFoundException());
      await expect(service.create(createDto, facultyActor)).rejects.toThrow(NotFoundException);
    });

    it('BR-010: rejects creation for a subject/batch the faculty is NOT assigned to teach — 403', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS', code: 'DBMS', name: 'Databases' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A', section: 'A', subsection: 'A1', year: '2026' });
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(false);

      await expect(service.create(createDto, facultyActor)).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('BR-010 rejection message names the actual subject/batch, not a raw id — shown verbatim to the faculty member', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS', code: 'DBMS', name: 'Databases' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A', section: 'A', subsection: 'A1', year: '2026' });
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(false);

      await expect(service.create(createDto, facultyActor)).rejects.toThrow(
        'You are not assigned to teach "DBMS — Databases" for batch "A/A1 (2026)"',
      );
    });

    it('rejects creation when ANY one of multiple target batches is unassigned (all-or-nothing)', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'any-batch' });
      facultyAssignmentsService.hasActiveAssignment
        .mockResolvedValueOnce(true) // batch-A: assigned
        .mockResolvedValueOnce(false); // batch-B: NOT assigned

      await expect(
        service.create({ ...createDto, batch_ids: ['batch-A', 'batch-B'] }, facultyActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a DRAFT quiz with quiz_batches rows when properly assigned', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(true);
      const created = { id: 'quiz-1', status: QuizStatus.DRAFT, ...createDto };
      prisma.__tx.quiz.create.mockResolvedValue(created);

      const result = await service.create(createDto, facultyActor);

      expect(result).toEqual(created);
      expect(prisma.__tx.quizBatch.createMany).toHaveBeenCalledWith({
        data: [{ quizId: 'quiz-1', batchId: 'batch-A' }],
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Quiz' }),
        expect.anything(),
      );
    });

    it('checks assignment against the (subject, batch, academic_year, semester) exact tuple, not just subject+batch', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(true);
      prisma.__tx.quiz.create.mockResolvedValue({ id: 'quiz-1' });

      await service.create(createDto, facultyActor);

      expect(facultyAssignmentsService.hasActiveAssignment).toHaveBeenCalledWith(
        'faculty-1',
        'subject-DBMS',
        'batch-A',
        '2026',
        1,
      );
    });
  });

  describe('findByIdScoped', () => {
    it('delegates to the access repository (IDOR-safe, ADMIN-or-owner-or-co-instructor) and enriches with null examSession when unattached', async () => {
      accessRepository.findScoped.mockResolvedValue({ id: 'q1' });
      prisma.examSessionQuiz.findFirst.mockResolvedValue(null);

      await expect(service.findByIdScoped('q1', facultyActor)).resolves.toEqual({ id: 'q1', examSession: null });
      expect(accessRepository.findScoped).toHaveBeenCalledWith('q1', facultyActor);
    });

    it('enriches with the active exam session + its allocated rooms when attached', async () => {
      accessRepository.findScoped.mockResolvedValue({ id: 'q1' });
      prisma.examSessionQuiz.findFirst.mockResolvedValue({
        examSession: {
          id: 'session-1',
          status: 'SEATING_GENERATION',
          allocatedRooms: [
            { allocatedCapacity: 30, room: { id: 'room-1', building: 'A', floor: 1, roomNumber: '101', capacity: 40 } },
          ],
        },
      });

      const result = await service.findByIdScoped('q1', facultyActor);

      expect(result.examSession).toEqual({
        id: 'session-1',
        status: 'SEATING_GENERATION',
        rooms: [{ id: 'room-1', building: 'A', floor: 1, roomNumber: '101', capacity: 40, allocatedCapacity: 30 }],
      });
    });
  });

  describe('list — role-scoped (BR-046)', () => {
    it('ADMIN sees an unscoped query (no OR-ownership filter)', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      await service.list({}, adminActor);

      const callArgs = prisma.quiz.findMany.mock.calls[0][0];
      expect(callArgs.where.AND[0]).toEqual({});
    });

    it('FACULTY sees only quizzes they created OR co-instruct — never an arbitrary faculty_id filter', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      prisma.facultySubjectBatchAssignment.findMany.mockResolvedValue([
        { subjectId: 'subject-OS', batchId: 'batch-B' },
      ]);
      prisma.quiz.findMany.mockResolvedValue([]);

      // Attacker-supplied faculty_id filter for a DIFFERENT faculty — must be ignored.
      await service.list({ facultyId: 'someone-elses-faculty-id' }, facultyActor);

      const callArgs = prisma.quiz.findMany.mock.calls[0][0];
      expect(callArgs.where.AND[0]).toEqual({
        OR: [
          { createdByFacultyId: 'faculty-1' },
          { subjectId: 'subject-OS', batches: { some: { batchId: 'batch-B' } } },
        ],
      });
      // The faculty_id filter is not present anywhere in the FACULTY-scoped query.
      expect(callArgs.where.AND[1].createdByFacultyId).toBeUndefined();
    });

    it('denormalizes the active exam session (id/status) onto each quiz, so a faculty can\'t start a second session for an already-scheduled one', async () => {
      prisma.quiz.findMany.mockResolvedValue([{ id: 'q1' }, { id: 'q2' }]);
      prisma.examSessionQuiz.findMany.mockResolvedValue([
        { quizId: 'q1', examSession: { id: 'session-1', status: 'IN_PROGRESS' } },
      ]);

      const result = await service.list({}, adminActor);

      expect(prisma.examSessionQuiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { quizId: { in: ['q1', 'q2'] }, isActiveAttachment: true } }),
      );
      expect(result.items.find((q) => q.id === 'q1')?.examSession).toEqual({ id: 'session-1', status: 'IN_PROGRESS' });
      expect(result.items.find((q) => q.id === 'q2')?.examSession).toBeNull();
    });
  });

  describe('update — resource-level auth, DRAFT-only editability, optimistic locking (BR-051)', () => {
    const existingDraft = {
      id: 'q1',
      status: QuizStatus.DRAFT,
      version: 3,
      subjectId: 'subject-DBMS',
      academicYear: '2026',
      semester: 1,
    };

    it('blocks a non-owner, non-co-instructor with 404 (IDOR-safe)', async () => {
      prisma.quiz.findUnique.mockResolvedValue(existingDraft);
      ownershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(
        service.update('q1', {}, 3, facultyActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects editing a non-DRAFT quiz with 409', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...existingDraft, status: QuizStatus.SUBMITTED });
      ownershipService.isOwnerOrCoInstructor.mockResolvedValue(true);

      await expect(service.update('q1', { title: 'x' }, 3, facultyActor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a stale version with 409 — BR-051, never a silent overwrite', async () => {
      prisma.quiz.findUnique.mockResolvedValue(existingDraft); // version 3
      ownershipService.isOwnerOrCoInstructor.mockResolvedValue(true);

      await expect(service.update('q1', { title: 'x' }, 2 /* stale */, facultyActor)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('applies the update and increments version when authorized and current', async () => {
      prisma.quiz.findUnique.mockResolvedValue(existingDraft);
      ownershipService.isOwnerOrCoInstructor.mockResolvedValue(true);
      prisma.__tx.quiz.update.mockResolvedValue({ ...existingDraft, title: 'Updated', version: 4 });

      const result = await service.update('q1', { title: 'Updated' }, 3, facultyActor);

      expect(result.version).toBe(4);
      expect(prisma.__tx.quiz.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1' },
          data: expect.objectContaining({ title: 'Updated', version: { increment: 1 } }),
        }),
      );
    });

    it('re-validates BR-010 when subject_id or batch_ids are being changed', async () => {
      prisma.quiz.findUnique.mockResolvedValue(existingDraft);
      ownershipService.isOwnerOrCoInstructor.mockResolvedValue(true);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS', code: 'DBMS', name: 'Databases' });
      batchesService.findById.mockResolvedValue({ id: 'batch-C', section: 'C', subsection: 'C1', year: '2026' });
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(false);

      await expect(
        service.update('q1', { batch_ids: ['batch-C'] }, 3, facultyActor),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does NOT re-run BR-010 when neither subject_id nor batch_ids are touched', async () => {
      prisma.quiz.findUnique.mockResolvedValue(existingDraft);
      ownershipService.isOwnerOrCoInstructor.mockResolvedValue(true);
      prisma.__tx.quiz.update.mockResolvedValue({ ...existingDraft, title: 'x', version: 4 });

      await service.update('q1', { title: 'x' }, 3, facultyActor);

      expect(facultyAssignmentsService.hasActiveAssignment).not.toHaveBeenCalled();
    });
  });

  describe('submit — owner-only (narrower than PATCH), completeness (422), re-authorization', () => {
    const baseQuiz = {
      id: 'q1',
      status: QuizStatus.DRAFT,
      createdByFacultyId: 'faculty-1',
      subjectId: 'subject-DBMS',
      academicYear: '2026',
      semester: 1,
      durationMinutes: 60,
      studentCount: 60,
      quizType: 'QUIZ',
      preferredDate: new Date('2026-05-01'),
      preferredTime: new Date('1970-01-01T10:00:00Z'),
    };

    it('rejects a co-instructor (not the owner) attempting to submit — 403, narrower than PATCH', async () => {
      prisma.quiz.findUnique.mockResolvedValue(baseQuiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-2' }); // different from createdByFacultyId

      await expect(service.submit('q1', facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it('rejects submitting an already-SUBMITTED quiz with 409', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...baseQuiz, status: QuizStatus.SUBMITTED });
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });

      await expect(service.submit('q1', facultyActor)).rejects.toThrow(ConflictException);
    });

    it('re-validates BR-010 at submission time — 403 if no longer assigned (assignment may have changed since creation)', async () => {
      prisma.quiz.findUnique.mockResolvedValue(baseQuiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(false);

      await expect(service.submit('q1', facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it('422s on an incomplete quiz — missing duration_minutes/student_count/etc.', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        ...baseQuiz,
        durationMinutes: null,
        studentCount: null,
        quizType: null,
      });
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(true);

      const error = await service.submit('q1', facultyActor).catch((e) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.message).toMatch(/duration_minutes/);
      expect(error.message).toMatch(/student_count/);
      expect(error.message).toMatch(/quiz_type/);
    });

    it('does NOT require instructions to be present — it is optional even at submit', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...baseQuiz, instructions: null });
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(true);
      prisma.__tx.quiz.update.mockResolvedValue({ ...baseQuiz, status: QuizStatus.SUBMITTED });

      await expect(service.submit('q1', facultyActor)).resolves.toBeDefined();
    });

    it('transitions DRAFT -> SUBMITTED, records a SUBMITTED history row, and audits it', async () => {
      prisma.quiz.findUnique.mockResolvedValue(baseQuiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(true);
      prisma.__tx.quiz.update.mockResolvedValue({ ...baseQuiz, status: QuizStatus.SUBMITTED, version: 2 });

      const result = await service.submit('q1', facultyActor);

      expect(result.status).toBe(QuizStatus.SUBMITTED);
      expect(prisma.__tx.quiz.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: { status: QuizStatus.SUBMITTED, version: { increment: 1 } },
      });
      expect(approvalHistoryService.record).toHaveBeenCalledWith(
        {
          quizId: 'q1',
          action: 'SUBMITTED',
          actorId: facultyActor.id,
          previousStatus: QuizStatus.DRAFT,
          newStatus: QuizStatus.SUBMITTED,
        },
        expect.anything(),
      );
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'Quiz', action: 'UPDATE' }),
        expect.anything(),
      );
    });

    it('notifies every ADMIN user that a quiz was submitted for review', async () => {
      prisma.quiz.findUnique.mockResolvedValue(baseQuiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(true);
      prisma.__tx.quiz.update.mockResolvedValue({ ...baseQuiz, status: QuizStatus.SUBMITTED, version: 2 });
      prisma.__tx.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await service.submit('q1', facultyActor);

      expect(prisma.__tx.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { roles: { some: { role: { name: 'ADMIN' } } } } }),
      );
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientType: 'ADMIN', recipientId: 'admin-1', eventType: 'QUIZ_SUBMITTED', entityId: 'q1' }),
      );
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientType: 'ADMIN', recipientId: 'admin-2', eventType: 'QUIZ_SUBMITTED', entityId: 'q1' }),
      );
    });

    it('resubmission: a REJECTED quiz may be re-submitted, recording action RESUBMITTED (FR-021)', async () => {
      const rejectedQuiz = { ...baseQuiz, status: QuizStatus.REJECTED };
      prisma.quiz.findUnique.mockResolvedValue(rejectedQuiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
      facultyAssignmentsService.hasActiveAssignment.mockResolvedValue(true);
      prisma.__tx.quiz.update.mockResolvedValue({ ...rejectedQuiz, status: QuizStatus.SUBMITTED, version: 2 });

      const result = await service.submit('q1', facultyActor);

      expect(result.status).toBe(QuizStatus.SUBMITTED);
      expect(approvalHistoryService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESUBMITTED', previousStatus: QuizStatus.REJECTED }),
        expect.anything(),
      );
    });

    it('rejects submitting a quiz that is neither DRAFT nor REJECTED (e.g. already APPROVED) with 409', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...baseQuiz, status: QuizStatus.APPROVED });
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });

      await expect(service.submit('q1', facultyActor)).rejects.toThrow(ConflictException);
    });
  });

  describe('approve — BR-014 (defense in depth) + EC-047 (version-checked)', () => {
    const submittedQuiz = {
      id: 'q1',
      status: QuizStatus.SUBMITTED,
      version: 5,
      createdByFacultyId: 'faculty-1',
    };

    it('rejects a non-SUBMITTED quiz with 409', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...submittedQuiz, status: QuizStatus.DRAFT });
      facultyService.findByUserId.mockResolvedValue(null); // ADMIN, no faculty account

      await expect(service.approve('q1', 5, adminActor)).rejects.toThrow(ConflictException);
    });

    it('rejects a stale version with 409 (EC-047)', async () => {
      prisma.quiz.findUnique.mockResolvedValue(submittedQuiz); // version 5
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.approve('q1', 4 /* stale */, adminActor)).rejects.toThrow(ConflictException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('BR-014 defense in depth: blocks the actor if they ALSO happen to be the creating faculty, even with ADMIN role', async () => {
      prisma.quiz.findUnique.mockResolvedValue(submittedQuiz);
      // Simulate an actor who is both ADMIN and the quiz's own creator.
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' }); // matches createdByFacultyId

      await expect(service.approve('q1', 5, adminActor)).rejects.toThrow(ForbiddenException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('approves, records an APPROVED history row, queues a notification, and audits it', async () => {
      prisma.quiz.findUnique.mockResolvedValue(submittedQuiz);
      facultyService.findByUserId.mockResolvedValue(null); // pure ADMIN, not also a faculty
      prisma.__tx.quiz.update.mockResolvedValue({ ...submittedQuiz, status: QuizStatus.APPROVED, version: 6 });

      const result = await service.approve('q1', 5, adminActor);

      expect(result.status).toBe(QuizStatus.APPROVED);
      expect(approvalHistoryService.record).toHaveBeenCalledWith(
        {
          quizId: 'q1',
          action: QuizApprovalAction.APPROVED,
          actorId: adminActor.id,
          previousStatus: QuizStatus.SUBMITTED,
          newStatus: QuizStatus.APPROVED,
        },
        prisma.__tx,
      );
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ eventType: 'QUIZ_APPROVED', recipientId: 'user-faculty-1' }),
      );
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'Quiz', action: 'UPDATE' }),
        expect.anything(),
      );
    });
  });

  describe('reject — BR-012 (reason required, 422) + BR-014 (defense in depth)', () => {
    const submittedQuiz = {
      id: 'q1',
      status: QuizStatus.SUBMITTED,
      version: 5,
      createdByFacultyId: 'faculty-1',
    };

    it('422s when reason is missing', async () => {
      prisma.quiz.findUnique.mockResolvedValue(submittedQuiz);
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.reject('q1', {}, adminActor)).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('422s when reason is an empty/whitespace-only string', async () => {
      prisma.quiz.findUnique.mockResolvedValue(submittedQuiz);
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.reject('q1', { reason: '   ' }, adminActor)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects a non-SUBMITTED quiz with 409, even with a valid reason', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...submittedQuiz, status: QuizStatus.DRAFT });
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.reject('q1', { reason: 'Not ready' }, adminActor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('BR-014 defense in depth: blocks self-review on reject too, symmetric with approve', async () => {
      prisma.quiz.findUnique.mockResolvedValue(submittedQuiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' }); // the creator

      await expect(
        service.reject('q1', { reason: 'Self-review attempt' }, adminActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects with a reason, records a REJECTED history row (with the reason), queues a notification, and audits it', async () => {
      prisma.quiz.findUnique.mockResolvedValue(submittedQuiz);
      facultyService.findByUserId.mockResolvedValue(null);
      prisma.__tx.quiz.update.mockResolvedValue({ ...submittedQuiz, status: QuizStatus.REJECTED, version: 6 });

      const result = await service.reject('q1', { reason: 'Insufficient questions' }, adminActor);

      expect(result.status).toBe(QuizStatus.REJECTED);
      expect(approvalHistoryService.record).toHaveBeenCalledWith(
        {
          quizId: 'q1',
          action: QuizApprovalAction.REJECTED,
          actorId: adminActor.id,
          reason: 'Insufficient questions',
          previousStatus: QuizStatus.SUBMITTED,
          newStatus: QuizStatus.REJECTED,
        },
        prisma.__tx,
      );
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ eventType: 'QUIZ_REJECTED', recipientId: 'user-faculty-1' }),
      );
    });
  });

  describe('getApprovalHistory — ADMIN or owning FACULTY specifically (narrower than GET/PATCH)', () => {
    const quiz = { id: 'q1', createdByFacultyId: 'faculty-1' };

    it('ADMIN can view any quiz\'s history', async () => {
      prisma.quiz.findUnique.mockResolvedValue(quiz);
      approvalHistoryService.listForQuiz.mockResolvedValue([{ id: 'h1' }]);

      await expect(service.getApprovalHistory('q1', adminActor)).resolves.toEqual([{ id: 'h1' }]);
    });

    it('the OWNING faculty can view their own quiz\'s history', async () => {
      prisma.quiz.findUnique.mockResolvedValue(quiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
      approvalHistoryService.listForQuiz.mockResolvedValue([]);

      await expect(service.getApprovalHistory('q1', facultyActor)).resolves.toEqual([]);
    });

    it('a CO-INSTRUCTOR (not the owner) is blocked — narrower than GET/PATCH\'s co-instructor allowance', async () => {
      prisma.quiz.findUnique.mockResolvedValue(quiz);
      facultyService.findByUserId.mockResolvedValue({ id: 'faculty-2' }); // different from createdByFacultyId

      await expect(service.getApprovalHistory('q1', facultyActor)).rejects.toThrow(NotFoundException);
    });

    it('an unrelated faculty is blocked with 404 (IDOR-safe)', async () => {
      prisma.quiz.findUnique.mockResolvedValue(quiz);
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.getApprovalHistory('q1', facultyActor)).rejects.toThrow(NotFoundException);
    });
  });
});
