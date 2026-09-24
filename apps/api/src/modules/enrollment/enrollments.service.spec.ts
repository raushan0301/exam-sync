import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, EnrollmentStatus } from '@exam-sync/db';
import { EnrollmentsService } from './enrollments.service';
import { StudentsService } from '../students';
import { SubjectsService, BatchesService } from '../academic-structure';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    studentSubjectEnrollment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    ...tx,
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };
const faculty: AuthenticatedUser = { id: 'faculty-user-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };

describe('EnrollmentsService — BR-004/005/006 (the highest-leverage correctness surface in this phase)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let studentsService: { findById: jest.Mock };
  let subjectsService: { findById: jest.Mock };
  let batchesService: { findById: jest.Mock };
  let facultyAssignmentsService: { isFacultyTeachingBatch: jest.Mock };
  let importJobsService: { create: jest.Mock };
  let service: EnrollmentsService;

  const dto = {
    student_id: 'student-1',
    subject_id: 'subject-DBMS',
    batch_id: 'batch-A',
    academic_year: '2026',
    semester: 1,
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    studentsService = { findById: jest.fn() };
    subjectsService = { findById: jest.fn() };
    batchesService = { findById: jest.fn() };
    facultyAssignmentsService = { isFacultyTeachingBatch: jest.fn() };
    importJobsService = { create: jest.fn() };

    service = new EnrollmentsService(
      prisma,
      auditHook as unknown as AuditHookService,
      studentsService as unknown as StudentsService,
      subjectsService as unknown as SubjectsService,
      batchesService as unknown as BatchesService,
      facultyAssignmentsService as unknown as FacultyAssignmentsService,
      importJobsService as unknown as ImportJobsService,
    );
  });

  describe('create', () => {
    it('validates student, subject, and batch all exist', async () => {
      studentsService.findById.mockRejectedValue(new NotFoundException());
      await expect(service.create(dto, admin)).rejects.toThrow(NotFoundException);
      expect(prisma.studentSubjectEnrollment.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate (student, subject, year, semester) with 409 — BR-004', async () => {
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto, admin)).rejects.toThrow(ConflictException);
    });

    it('allows the SAME student to enroll in the SAME subject again in a DIFFERENT semester (uniqueness is per year+semester)', async () => {
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);
      prisma.studentSubjectEnrollment.create.mockResolvedValue({ id: 'e2', ...dto, semester: 2 });

      await expect(service.create({ ...dto, semester: 2 }, admin)).resolves.toBeDefined();
    });

    it('does NOT validate that batch_id matches the student\'s current batch (EC-017: independent snapshot)', async () => {
      studentsService.findById.mockResolvedValue({ id: 'student-1', batchId: 'student-current-batch' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'a-totally-different-batch' });
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);
      prisma.studentSubjectEnrollment.create.mockResolvedValue({
        id: 'e1',
        ...dto,
        batch_id: 'a-totally-different-batch',
      });

      await expect(
        service.create({ ...dto, batch_id: 'a-totally-different-batch' }, admin),
      ).resolves.toBeDefined();
      // The only check performed is that the batch itself exists.
      expect(batchesService.findById).toHaveBeenCalledWith('a-totally-different-batch');
    });

    it('maps a raw DB unique-constraint violation (race condition) to 409', async () => {
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);
      prisma.studentSubjectEnrollment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(service.create(dto, admin)).rejects.toThrow(ConflictException);
    });

    it('allows both ADMIN and FACULTY to create — but this is a role-level concern, tested at e2e, not here', async () => {
      // (Documented here for traceability: create() itself performs no
      // role check — that's RolesGuard's job at the controller. This
      // service-level test just confirms create() has no actor-role
      // branch that would silently reject a FACULTY caller.)
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);
      prisma.studentSubjectEnrollment.create.mockResolvedValue({ id: 'e1', ...dto });

      await expect(service.create(dto, faculty)).resolves.toBeDefined();
    });
  });

  describe('isEnrolled — THE literal implementation of BR-005', () => {
    it('returns TRUE only when a matching row exists with status ENROLLED', async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        status: EnrollmentStatus.ENROLLED,
      });

      await expect(
        service.isEnrolled('student-1', 'subject-DBMS', '2026', 1),
      ).resolves.toBe(true);
    });

    it('returns FALSE when NO enrollment row exists at all — this is BR-005\'s core claim: batch membership alone proves nothing', async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.isEnrolled('student-in-the-batch-but-never-enrolled', 'subject-DBMS', '2026', 1),
      ).resolves.toBe(false);
    });

    it('returns FALSE for a DROPPED enrollment — dropping removes eligibility (BR-006)', async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        status: EnrollmentStatus.DROPPED,
      });

      await expect(service.isEnrolled('student-1', 'subject-DBMS', '2026', 1)).resolves.toBe(false);
    });

    it('returns FALSE for COMPLETED, INACTIVE, and WITHDRAWN — only the literal ENROLLED value counts', async () => {
      for (const status of [
        EnrollmentStatus.COMPLETED,
        EnrollmentStatus.INACTIVE,
        EnrollmentStatus.WITHDRAWN,
      ]) {
        prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({ status });
        await expect(service.isEnrolled('student-1', 'subject-DBMS', '2026', 1)).resolves.toBe(
          false,
        );
      }
    });

    it('returns FALSE for a matching subject in a DIFFERENT academic_year/semester — eligibility is scoped exactly to the term', async () => {
      // The mock simulates the DB's compound-unique lookup: a row exists
      // for 2026/semester 1, but we ask about 2027/semester 1 — no match.
      prisma.studentSubjectEnrollment.findUnique.mockImplementation(({ where }: any) => {
        const key = where.studentId_subjectId_academicYear_semester;
        if (key.academicYear === '2026' && key.semester === 1) {
          return Promise.resolve({ status: EnrollmentStatus.ENROLLED });
        }
        return Promise.resolve(null);
      });

      await expect(service.isEnrolled('student-1', 'subject-DBMS', '2026', 1)).resolves.toBe(true);
      await expect(service.isEnrolled('student-1', 'subject-DBMS', '2027', 1)).resolves.toBe(false);
    });
  });

  describe('findEligibleStudentIds — Phase 9\'s bulk BR-005 eligibility derivation', () => {
    it('returns [] immediately for an empty batch list without querying the DB', async () => {
      await expect(
        service.findEligibleStudentIds('subject-DBMS', [], '2026', 1),
      ).resolves.toEqual([]);
      expect(prisma.studentSubjectEnrollment.findMany).not.toHaveBeenCalled();
    });

    it('queries ENROLLED rows matching subject/academic_year/semester and any of the given batch ids', async () => {
      prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
        { studentId: 'student-1' },
        { studentId: 'student-2' },
      ]);

      const result = await service.findEligibleStudentIds(
        'subject-DBMS',
        ['batch-A', 'batch-B'],
        '2026',
        1,
      );

      expect(result).toEqual(['student-1', 'student-2']);
      expect(prisma.studentSubjectEnrollment.findMany).toHaveBeenCalledWith({
        where: {
          subjectId: 'subject-DBMS',
          academicYear: '2026',
          semester: 1,
          status: EnrollmentStatus.ENROLLED,
          batchId: { in: ['batch-A', 'batch-B'] },
        },
        select: { studentId: true },
      });
    });
  });

  describe('listForStudent — resource-level authorization (self / ADMIN / teaching FACULTY)', () => {
    it('lets the student themself list their own enrollments', async () => {
      studentsService.findById.mockResolvedValue({ id: 's1', userId: 'student-user-1', batchId: 'b1' });
      prisma.studentSubjectEnrollment.findMany.mockResolvedValue([]);

      const actor: AuthenticatedUser = { id: 'student-user-1', email: 's@b.com', roles: ['STUDENT'], mustChangePassword: false };
      await expect(service.listForStudent('s1', actor)).resolves.toEqual([]);
      expect(facultyAssignmentsService.isFacultyTeachingBatch).not.toHaveBeenCalled();
    });

    it('lets ADMIN list any student\'s enrollments', async () => {
      studentsService.findById.mockResolvedValue({ id: 's1', userId: 'someone-else', batchId: 'b1' });
      prisma.studentSubjectEnrollment.findMany.mockResolvedValue([]);

      await expect(service.listForStudent('s1', admin)).resolves.toEqual([]);
    });

    it('lets a teaching FACULTY member list the enrollments of a student in their batch', async () => {
      studentsService.findById.mockResolvedValue({ id: 's1', userId: 'someone-else', batchId: 'batch-A' });
      facultyAssignmentsService.isFacultyTeachingBatch.mockResolvedValue(true);
      prisma.studentSubjectEnrollment.findMany.mockResolvedValue([]);

      await expect(service.listForStudent('s1', faculty)).resolves.toEqual([]);
      expect(facultyAssignmentsService.isFacultyTeachingBatch).toHaveBeenCalledWith(
        'faculty-user-1',
        'batch-A',
      );
    });

    it('blocks a non-teaching FACULTY member with 404, not 403 (IDOR-safe, mirrors EC-038)', async () => {
      studentsService.findById.mockResolvedValue({ id: 's1', userId: 'someone-else', batchId: 'batch-A' });
      facultyAssignmentsService.isFacultyTeachingBatch.mockResolvedValue(false);

      await expect(service.listForStudent('s1', faculty)).rejects.toThrow(NotFoundException);
    });

    it('blocks an unrelated STUDENT with 404', async () => {
      studentsService.findById.mockResolvedValue({ id: 's1', userId: 'the-real-owner', batchId: 'b1' });
      const otherStudent: AuthenticatedUser = { id: 'a-different-student', email: 'x@b.com', roles: ['STUDENT'], mustChangePassword: false };

      await expect(service.listForStudent('s1', otherStudent)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update (PATCH /enrollments/:id) — status transitions', () => {
    it('sets droppedAt when transitioning to DROPPED', async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: EnrollmentStatus.ENROLLED,
        droppedAt: null,
      });
      prisma.studentSubjectEnrollment.update.mockResolvedValue({
        id: 'e1',
        status: EnrollmentStatus.DROPPED,
        droppedAt: new Date(),
      });

      await service.update('e1', { status: EnrollmentStatus.DROPPED }, admin);

      expect(prisma.studentSubjectEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: EnrollmentStatus.DROPPED, droppedAt: expect.any(Date) },
      });
    });

    it('clears droppedAt when transitioning AWAY from DROPPED', async () => {
      const droppedDate = new Date('2026-01-01');
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: EnrollmentStatus.DROPPED,
        droppedAt: droppedDate,
      });
      prisma.studentSubjectEnrollment.update.mockResolvedValue({
        id: 'e1',
        status: EnrollmentStatus.ENROLLED,
        droppedAt: null,
      });

      await service.update('e1', { status: EnrollmentStatus.ENROLLED }, admin);

      expect(prisma.studentSubjectEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: EnrollmentStatus.ENROLLED, droppedAt: null },
      });
    });

    it('leaves droppedAt untouched for a status change that involves neither entering nor leaving DROPPED', async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: EnrollmentStatus.ENROLLED,
        droppedAt: null,
      });
      prisma.studentSubjectEnrollment.update.mockResolvedValue({
        id: 'e1',
        status: EnrollmentStatus.COMPLETED,
        droppedAt: null,
      });

      await service.update('e1', { status: EnrollmentStatus.COMPLETED }, admin);

      expect(prisma.studentSubjectEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: EnrollmentStatus.COMPLETED, droppedAt: null },
      });
    });

    it('404s for a non-existent enrollment', async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: EnrollmentStatus.DROPPED }, admin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulkCreate (EC-044 partial failure)', () => {
    it('processes each row independently — a bad row never blocks the rest', async () => {
      studentsService.findById.mockResolvedValue({ id: 'student-1' });
      subjectsService.findById.mockImplementation((id: string) =>
        id === 'subject-DBMS' ? Promise.resolve({ id }) : Promise.reject(new NotFoundException()),
      );
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);
      prisma.studentSubjectEnrollment.create.mockResolvedValue({ id: 'e1' });

      let captured: any;
      importJobsService.create.mockImplementation((input: any) => {
        captured = input;
        return Promise.resolve({ id: 'job-1', ...input });
      });

      const rows = [
        { ...dto, subject_id: 'subject-DBMS' },
        { ...dto, subject_id: 'MISSING-SUBJECT' },
      ];

      const job = await service.bulkCreate(rows, admin);

      expect(job.id).toBe('job-1');
      expect(captured.totalRows).toBe(2);
      expect(captured.successCount).toBe(1);
      expect(captured.failureCount).toBe(1);
      expect(captured.results[0]).toEqual(expect.objectContaining({ row: 1, status: 'SUCCESS' }));
      expect(captured.results[1]).toEqual(expect.objectContaining({ row: 2, status: 'FAILURE' }));
    });
  });
});
