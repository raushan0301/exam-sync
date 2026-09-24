import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, Prisma, QuizStatus, QuizStudentAssignmentStatus } from '@exam-sync/db';
import { StudentAssignmentService } from './student-assignment.service';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { ConflictEngineService } from '../conflict-engine';
import { QuizzesService } from '../quiz';
import { StudentsService } from '../students';
import { EnrollmentsService } from '../enrollment';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  // `tx` shares the SAME `quizStudentAssignment` mock as the top-level
  // object, so assertions against `prisma.quizStudentAssignment.*` see
  // calls made through `runSerializable`'s transaction client too — the
  // service always writes assignments via `tx`, never `this.prisma`
  // directly, now that Phase 10 wraps every assignment write in
  // `runSerializable`.
  const quizStudentAssignment = { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() };
  // `examSession` is likewise shared between the top-level mock and `tx` —
  // Phase 20 now wraps `assignStudents`'s session status update in its own
  // `$transaction`, writing via `tx.examSession.update`, so assertions
  // against `prisma.examSession.update` must see calls made through that
  // transaction client too.
  const examSession = { update: jest.fn() };
  const tx = { quizStudentAssignment, examSession };
  return {
    examSessionQuiz: { findMany: jest.fn(), findFirst: jest.fn() },
    examSession,
    quizStudentAssignment,
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('StudentAssignmentService — eligibility-derived assignment, roster add/remove, real BR-019 conflict-checking (Phase 10)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let importJobsService: { create: jest.Mock };
  let examSessionsService: { findById: jest.Mock; findByIdScoped: jest.Mock };
  let conflictEngine: { checkSessionAssembly: jest.Mock };
  let quizzesService: { findById: jest.Mock; getBatchIds: jest.Mock };
  let studentsService: { findById: jest.Mock };
  let enrollmentsService: { findEligibleStudentIds: jest.Mock };
  let examSessionOwnershipService: { isOwnerOrCoInstructor: jest.Mock };
  let service: StudentAssignmentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    importJobsService = { create: jest.fn() };
    examSessionsService = { findById: jest.fn(), findByIdScoped: jest.fn() };
    conflictEngine = { checkSessionAssembly: jest.fn().mockResolvedValue({ hard: [], warnings: [] }) };
    quizzesService = { findById: jest.fn(), getBatchIds: jest.fn() };
    studentsService = { findById: jest.fn() };
    enrollmentsService = { findEligibleStudentIds: jest.fn() };
    examSessionOwnershipService = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };

    service = new StudentAssignmentService(
      prisma,
      auditHook as unknown as AuditHookService,
      importJobsService as unknown as ImportJobsService,
      examSessionsService as unknown as ExamSessionsService,
      conflictEngine as unknown as ConflictEngineService,
      quizzesService as unknown as QuizzesService,
      studentsService as unknown as StudentsService,
      enrollmentsService as unknown as EnrollmentsService,
      examSessionOwnershipService as unknown as ExamSessionOwnershipService,
    );
  });

  describe('assignStudents', () => {
    const draftSession = { id: 's1', status: ExamSessionStatus.DRAFT };

    it('rejects a non-DRAFT session with 409', async () => {
      examSessionsService.findById.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.CANCELLED });

      await expect(service.assignStudents('s1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.examSessionQuiz.findMany).not.toHaveBeenCalled();
    });

    it('404s a faculty who owns/co-instructs none of the session\'s attached quizzes — faculty-lifecycle-ownership gate', async () => {
      examSessionsService.findById.mockResolvedValue(draftSession);
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(service.assignStudents('s1', admin)).rejects.toThrow(NotFoundException);
      expect(prisma.examSessionQuiz.findMany).not.toHaveBeenCalled();
    });

    it('rejects a DRAFT session with no actively-attached quizzes with 409', async () => {
      examSessionsService.findById.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([]);

      await expect(service.assignStudents('s1', admin)).rejects.toThrow(ConflictException);
      expect(prisma.examSession.update).not.toHaveBeenCalled();
    });

    it('derives eligible students per attached quiz, upserts one assignment per (quiz, student), and transitions DRAFT -> ASSIGNING_STUDENTS', async () => {
      examSessionsService.findById.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-1' }, { quizId: 'quiz-2' }]);
      quizzesService.findById.mockImplementation((id: string) =>
        Promise.resolve({ id, subjectId: `subj-${id}`, academicYear: '2026', semester: 1, status: QuizStatus.APPROVED }),
      );
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockImplementation((subjectId: string) =>
        Promise.resolve(subjectId === 'subj-quiz-1' ? ['student-1', 'student-2'] : ['student-2']),
      );
      prisma.quizStudentAssignment.upsert.mockImplementation(({ create }: any) =>
        Promise.resolve({ id: `${create.quizId}:${create.studentId}`, ...create }),
      );
      prisma.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.ASSIGNING_STUDENTS, version: 2 });
      importJobsService.create.mockResolvedValue({
        id: 'job-1',
        status: 'COMPLETED',
        totalRows: 3,
        successCount: 3,
        failureCount: 0,
      });

      const result = await service.assignStudents('s1', admin);

      expect(prisma.quizStudentAssignment.upsert).toHaveBeenCalledTimes(3); // (quiz-1,student-1), (quiz-1,student-2), (quiz-2,student-2)
      expect(prisma.examSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: ExamSessionStatus.ASSIGNING_STUDENTS, version: { increment: 1 } },
      });
      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'quiz_student_assignments', totalRows: 3, successCount: 3, failureCount: 0 }),
      );
      expect(result.examSession.status).toBe(ExamSessionStatus.ASSIGNING_STUDENTS);
      expect(result.importJob.id).toBe('job-1');
    });

    it('a student with a DROPPED enrollment is excluded — never even attempted', async () => {
      examSessionsService.findById.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-1' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue([]); // EnrollmentsService itself excludes DROPPED (BR-006) — asserted in its own spec
      prisma.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.ASSIGNING_STUDENTS, version: 2 });
      importJobsService.create.mockResolvedValue({ id: 'job-1', status: 'COMPLETED', totalRows: 0, successCount: 0, failureCount: 0 });

      await service.assignStudents('s1', admin);

      expect(prisma.quizStudentAssignment.upsert).not.toHaveBeenCalled();
    });

    it('one duplicate-assignment race (P2002) is recorded as a row failure, not a thrown error that aborts the whole batch', async () => {
      examSessionsService.findById.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-1' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1', 'student-2']);
      prisma.quizStudentAssignment.upsert
        .mockRejectedValueOnce(p2002())
        .mockResolvedValueOnce({ id: 'quiz-1:student-2' });
      prisma.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.ASSIGNING_STUDENTS, version: 2 });
      importJobsService.create.mockResolvedValue({ id: 'job-1', status: 'COMPLETED', totalRows: 2, successCount: 1, failureCount: 1 });

      await service.assignStudents('s1', admin);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ successCount: 1, failureCount: 1 }),
      );
      // Still transitions the session even with one row-level failure — EC-044's "partial, not all-or-nothing" semantics.
      expect(prisma.examSession.update).toHaveBeenCalled();
    });

    it('re-running assign-students on the same session after it left DRAFT is rejected (session-level idempotency guard)', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.ASSIGNING_STUDENTS });

      await expect(service.assignStudents('s1', admin)).rejects.toThrow(ConflictException);
    });

    it('BR-019: a student the real Conflict Engine flags as STUDENT_OVERLAP is skipped (row-level FAILURE), never assigned', async () => {
      examSessionsService.findById.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-1' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1', 'student-2']);
      conflictEngine.checkSessionAssembly.mockResolvedValue({
        hard: [
          {
            type: 'STUDENT_OVERLAP',
            studentId: 'student-1',
            conflictingExamSessionId: 'other-session',
            message: 'Test Student (100001) already has an active assignment in "Other Exam", whose time window overlaps this session (BR-019).',
          },
        ],
        warnings: [],
      });
      prisma.__tx.quizStudentAssignment.upsert.mockResolvedValue({ id: 'quiz-1:student-2' });
      prisma.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.ASSIGNING_STUDENTS, version: 2 });
      importJobsService.create.mockResolvedValue({ id: 'job-1', status: 'COMPLETED', totalRows: 2, successCount: 1, failureCount: 1 });

      await service.assignStudents('s1', admin);

      expect(prisma.quizStudentAssignment.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.quizStudentAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ studentId: 'student-2' }) }),
      );
      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 1,
          failureCount: 1,
          results: expect.arrayContaining([
            expect.objectContaining({ status: 'FAILURE', error: expect.stringContaining('BR-019') }),
          ]),
        }),
      );
    });

    it('opens one SERIALIZABLE transaction per attached quiz, checking the real Conflict Engine INSIDE it before writing', async () => {
      examSessionsService.findById.mockResolvedValue(draftSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([{ quizId: 'quiz-1' }]);
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
      prisma.__tx.quizStudentAssignment.upsert.mockResolvedValue({ id: 'quiz-1:student-1' });
      prisma.examSession.update.mockResolvedValue({ ...draftSession, status: ExamSessionStatus.ASSIGNING_STUDENTS, version: 2 });
      importJobsService.create.mockResolvedValue({ id: 'job-1', status: 'COMPLETED', totalRows: 1, successCount: 1, failureCount: 0 });

      await service.assignStudents('s1', admin);

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(
        expect.objectContaining({ examSessionId: 's1', quizIds: ['quiz-1'] }),
        prisma.__tx,
      );
    });
  });

  describe('addRosterEntry — manual add (EC-015), still BR-005-eligibility-gated', () => {
    const activeSession = { id: 's1', status: ExamSessionStatus.DRAFT };

    it('404s if the target quiz is not actively attached to this session', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue(null);

      await expect(
        service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects modifying the roster of a CANCELLED session', async () => {
      examSessionsService.findById.mockResolvedValue({ ...activeSession, status: ExamSessionStatus.CANCELLED });

      await expect(
        service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.examSessionQuiz.findFirst).not.toHaveBeenCalled();
    });

    it('404s a faculty who owns/co-instructs none of the session\'s attached quizzes — faculty-lifecycle-ownership gate', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(
        service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.examSessionQuiz.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an ineligible student (not ENROLLED in the quiz subject/batch) with 409', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 's1', quizId: 'quiz-1' });
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['some-other-student']);

      await expect(
        service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.quizStudentAssignment.upsert).not.toHaveBeenCalled();
    });

    it('adds an eligible student and audits it as CREATE when no prior row existed', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 's1', quizId: 'quiz-1' });
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(null);
      prisma.quizStudentAssignment.upsert.mockResolvedValue({
        id: 'a1',
        quizId: 'quiz-1',
        studentId: 'student-1',
        status: QuizStudentAssignmentStatus.ASSIGNED,
      });

      await service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin);

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'QuizStudentAssignment' }),
        expect.anything(),
      );
    });

    it('is idempotent: re-adding an already-ASSIGNED student is a no-op, no upsert call', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 's1', quizId: 'quiz-1' });
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
      const existing = { id: 'a1', quizId: 'quiz-1', studentId: 'student-1', status: QuizStudentAssignmentStatus.ASSIGNED };
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(existing);

      const result = await service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin);

      expect(result).toBe(existing);
      expect(prisma.quizStudentAssignment.upsert).not.toHaveBeenCalled();
      expect(auditHook.record).not.toHaveBeenCalled();
    });

    it('reactivates a previously-CANCELLED assignment and audits it as REACTIVATE', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 's1', quizId: 'quiz-1' });
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
      const existing = { id: 'a1', quizId: 'quiz-1', studentId: 'student-1', status: QuizStudentAssignmentStatus.CANCELLED };
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(existing);
      prisma.quizStudentAssignment.upsert.mockResolvedValue({ ...existing, status: QuizStudentAssignmentStatus.ASSIGNED, cancelledAt: null });

      await service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin);

      expect(prisma.quizStudentAssignment.upsert).toHaveBeenCalledWith({
        where: { quizId_studentId: { quizId: 'quiz-1', studentId: 'student-1' } },
        create: { quizId: 'quiz-1', examSessionId: 's1', studentId: 'student-1', status: QuizStudentAssignmentStatus.ASSIGNED },
        update: { examSessionId: 's1', status: QuizStudentAssignmentStatus.ASSIGNED, assignedAt: expect.any(Date), cancelledAt: null },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REACTIVATE' }),
        expect.anything(),
      );
    });

    it('translates a genuine duplicate-assignment race (P2002) into a ConflictException (ADR-003 item b)', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 's1', quizId: 'quiz-1' });
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(null);
      prisma.quizStudentAssignment.upsert.mockRejectedValue(p2002());

      await expect(
        service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('BR-019: rejects a manual add when the real Conflict Engine reports STUDENT_OVERLAP for this student — checked INSIDE the same SERIALIZABLE transaction as the write', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 's1', quizId: 'quiz-1' });
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(null);
      conflictEngine.checkSessionAssembly.mockResolvedValue({
        hard: [{ type: 'STUDENT_OVERLAP', studentId: 'student-1', conflictingExamSessionId: 'other-session', message: 'Student "student-1" overlaps.' }],
        warnings: [],
      });

      await expect(
        service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.quizStudentAssignment.upsert).not.toHaveBeenCalled();
      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(
        expect.objectContaining({ examSessionId: 's1', quizIds: ['quiz-1'] }),
        prisma.__tx,
      );
    });

    it('a STUDENT_OVERLAP conflict for a DIFFERENT student does not block this add', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 's1', quizId: 'quiz-1' });
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
      quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
      enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(null);
      conflictEngine.checkSessionAssembly.mockResolvedValue({
        hard: [{ type: 'STUDENT_OVERLAP', studentId: 'SOME-OTHER-STUDENT', message: 'unrelated' }],
        warnings: [],
      });
      prisma.__tx.quizStudentAssignment.upsert.mockResolvedValue({
        id: 'a1', quizId: 'quiz-1', studentId: 'student-1', status: QuizStudentAssignmentStatus.ASSIGNED,
      });

      const result = await service.addRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1' }, admin);

      expect(result.studentId).toBe('student-1');
    });
  });

  describe('removeRosterEntry — cancellation (EC-016), status change only, never a delete', () => {
    it('404s a faculty who owns/co-instructs none of the session\'s attached quizzes — faculty-lifecycle-ownership gate', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.ASSIGNING_STUDENTS });
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(
        service.removeRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1', reason: 'Withdrew' }, admin),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.quizStudentAssignment.findUnique).not.toHaveBeenCalled();
    });

    it('404s when no assignment exists for (quiz, student) in this session', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.ASSIGNING_STUDENTS });
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(null);

      await expect(
        service.removeRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1', reason: 'Withdrew' }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when the assignment exists but belongs to a DIFFERENT exam session', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.ASSIGNING_STUDENTS });
      prisma.quizStudentAssignment.findUnique.mockResolvedValue({
        id: 'a1', examSessionId: 'OTHER-SESSION', quizId: 'quiz-1', studentId: 'student-1', status: QuizStudentAssignmentStatus.ASSIGNED,
      });

      await expect(
        service.removeRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1', reason: 'Withdrew' }, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects cancelling an already-CANCELLED assignment with 409', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.ASSIGNING_STUDENTS });
      prisma.quizStudentAssignment.findUnique.mockResolvedValue({
        id: 'a1', examSessionId: 's1', quizId: 'quiz-1', studentId: 'student-1', status: QuizStudentAssignmentStatus.CANCELLED,
      });

      await expect(
        service.removeRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1', reason: 'Withdrew' }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('cancels an ASSIGNED entry — status change, audited with the given reason, never a physical delete', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.ASSIGNING_STUDENTS });
      const existing = { id: 'a1', examSessionId: 's1', quizId: 'quiz-1', studentId: 'student-1', status: QuizStudentAssignmentStatus.ASSIGNED };
      prisma.quizStudentAssignment.findUnique.mockResolvedValue(existing);
      prisma.quizStudentAssignment.update.mockResolvedValue({ ...existing, status: QuizStudentAssignmentStatus.CANCELLED, cancelledAt: new Date() });

      const result = await service.removeRosterEntry('s1', 'student-1', { quiz_id: 'quiz-1', reason: 'Dropped subject' }, admin);

      expect(result.status).toBe(QuizStudentAssignmentStatus.CANCELLED);
      expect(prisma.quizStudentAssignment.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { status: QuizStudentAssignmentStatus.CANCELLED, cancelledAt: expect.any(Date) },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE', entityType: 'QuizStudentAssignment', reason: 'Dropped subject' }),
        expect.anything(),
      );
    });
  });

  describe('getRoster — scoped listing', () => {
    it('delegates authorization to ExamSessionsService.findByIdScoped before listing anything', async () => {
      examSessionsService.findByIdScoped.mockRejectedValue(new NotFoundException());
      prisma.quizStudentAssignment.findMany.mockResolvedValue([]);

      await expect(service.getRoster('s1', admin, {})).rejects.toThrow(NotFoundException);
      expect(prisma.quizStudentAssignment.findMany).not.toHaveBeenCalled();
    });

    it('returns a paginated page of roster rows for the session', async () => {
      examSessionsService.findByIdScoped.mockResolvedValue({ id: 's1' });
      prisma.quizStudentAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          quizId: 'quiz-1',
          studentId: 'student-1',
          status: QuizStudentAssignmentStatus.ASSIGNED,
          quiz: { title: 'DBMS Quiz' },
          student: { name: 'Test Student', rollNumber: '100001' },
        },
      ]);

      const result = await service.getRoster('s1', admin, {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({ quizTitle: 'DBMS Quiz', studentName: 'Test Student', studentRollNumber: '100001' }),
      );
      expect(result.items[0]).not.toHaveProperty('quiz');
      expect(result.items[0]).not.toHaveProperty('student');
      expect(result.next_cursor).toBeNull();
    });

    it('filters by status when provided', async () => {
      examSessionsService.findByIdScoped.mockResolvedValue({ id: 's1' });
      prisma.quizStudentAssignment.findMany.mockResolvedValue([]);

      await service.getRoster('s1', admin, { status: QuizStudentAssignmentStatus.CANCELLED });

      expect(prisma.quizStudentAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { examSessionId: 's1', status: QuizStudentAssignmentStatus.CANCELLED },
        }),
      );
    });

    it("resolves the quiz's title off this row's own quiz relation — stays correct even after cancellation detaches the quiz from the session's active-attachment list", async () => {
      examSessionsService.findByIdScoped.mockResolvedValue({ id: 's1', status: 'CANCELLED', quizzes: [] });
      prisma.quizStudentAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          quizId: 'quiz-1',
          studentId: 'student-1',
          status: QuizStudentAssignmentStatus.ASSIGNED,
          quiz: { title: 'DBMS Quiz' },
          student: { name: 'Test Student', rollNumber: '100001' },
        },
      ]);

      const result = await service.getRoster('s1', admin, {});

      expect(result.items[0].quizTitle).toBe('DBMS Quiz');
    });
  });
});
