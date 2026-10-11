import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, EnrollmentStatus } from '@exam-sync/db';
import { EnrollmentsService } from './enrollments.service';
import { StudentsService } from '../students';
import { SubjectsService, BatchesService } from '../academic-structure';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';

function buildPrismaMock() {
  const tx = {
    studentSubjectEnrollment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      createManyAndReturn: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    ...tx,
    student: { findMany: jest.fn().mockResolvedValue([]) },
    subject: { findMany: jest.fn().mockResolvedValue([]) },
    batch: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };
const faculty: AuthenticatedUser = { id: 'faculty-user-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };

describe('EnrollmentsService — BR-004/005/006 (the highest-leverage correctness surface in this phase)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock; recordMany: jest.Mock };
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
    auditHook = { record: jest.fn(), recordMany: jest.fn() };
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

  describe('bulk paths — batched (constant query count, EC-044 partial failure)', () => {
    const insertEcho = () =>
      prisma.studentSubjectEnrollment.createManyAndReturn.mockImplementation(({ data }: any) =>
        Promise.resolve(data.map((d: any, i: number) => ({ id: `enr-${i + 1}`, ...d }))),
      );
    const jobResult = () => importJobsService.create.mock.calls[0][0];

    beforeEach(() => {
      prisma.studentSubjectEnrollment.findMany.mockResolvedValue([]); // no existing enrollments
      insertEcho();
    });

    describe('bulkCreate (form)', () => {
      beforeEach(() => {
        prisma.student.findMany.mockResolvedValue([{ id: 'student-1' }, { id: 'student-2' }]);
        prisma.subject.findMany.mockResolvedValue([{ id: 'subject-DBMS' }]);
        prisma.batch.findMany.mockResolvedValue([{ id: 'batch-A' }]);
      });

      it('a bad row never blocks the rest, with a specific message', async () => {
        await service.bulkCreate(
          [
            { ...dto, subject_id: 'subject-DBMS' },
            { ...dto, subject_id: 'MISSING-SUBJECT' },
            { ...dto, student_id: 'MISSING-STUDENT', subject_id: 'subject-DBMS' },
          ],
          admin,
        );

        const { totalRows, successCount, failureCount, results } = jobResult();
        expect([totalRows, successCount, failureCount]).toEqual([3, 1, 2]);
        expect(results[0]).toEqual({ row: 1, status: 'SUCCESS', id: 'enr-1' });
        expect(results[1]).toEqual({ row: 2, status: 'FAILURE', error: 'Subject not found' });
        expect(results[2]).toEqual({ row: 3, status: 'FAILURE', error: 'Student not found' });
      });

      it('an existing enrollment fails that row, and a repeat inside the same request counts as already enrolled', async () => {
        prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
          { studentId: 'student-1', subjectId: 'subject-DBMS', academicYear: '2026', semester: 1 },
        ]);

        await service.bulkCreate(
          [
            { ...dto, subject_id: 'subject-DBMS' }, // exists in DB
            { ...dto, student_id: 'student-2', subject_id: 'subject-DBMS' }, // new
            { ...dto, student_id: 'student-2', subject_id: 'subject-DBMS' }, // repeat of the new one
          ],
          admin,
        );

        const { results } = jobResult();
        expect(results.map((r: any) => r.status)).toEqual(['FAILURE', 'SUCCESS', 'FAILURE']);
        expect(results[0].error).toContain('already enrolled');
        expect(results[2].error).toContain('already enrolled');
      });

      it('uses a FIXED number of queries for 50 rows: one duplicate lookup, one insert, one audit write', async () => {
        const many = Array.from({ length: 50 }, (_, i) => ({ ...dto, semester: i + 1, subject_id: 'subject-DBMS' }));

        await service.bulkCreate(many, admin);

        expect(jobResult().successCount).toBe(50);
        expect(prisma.studentSubjectEnrollment.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.studentSubjectEnrollment.createManyAndReturn).toHaveBeenCalledTimes(1);
        expect(auditHook.recordMany).toHaveBeenCalledTimes(1);
        expect(auditHook.recordMany.mock.calls[0][0]).toHaveLength(50); // still one audit row per enrollment
        // none of the old per-row calls
        expect(prisma.studentSubjectEnrollment.create).not.toHaveBeenCalled();
        expect(prisma.studentSubjectEnrollment.findUnique).not.toHaveBeenCalled();
        expect(studentsService.findById).not.toHaveBeenCalled();
        expect(auditHook.record).not.toHaveBeenCalled();
      });

      it('falls back to row-by-row when the batched insert fails (e.g. a concurrent duplicate), so only the offender fails', async () => {
        prisma.studentSubjectEnrollment.createManyAndReturn.mockRejectedValue(new Error('unique violation'));
        studentsService.findById.mockResolvedValue({});
        subjectsService.findById.mockResolvedValue({});
        batchesService.findById.mockResolvedValue({});
        prisma.studentSubjectEnrollment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'raced' });
        prisma.studentSubjectEnrollment.create.mockResolvedValue({ id: 'enr-fallback' });

        await service.bulkCreate(
          [
            { ...dto, subject_id: 'subject-DBMS' },
            { ...dto, student_id: 'student-2', subject_id: 'subject-DBMS' },
          ],
          admin,
        );

        const { results } = jobResult();
        expect(results[0]).toEqual({ row: 1, status: 'SUCCESS', id: 'enr-fallback' });
        expect(results[1]).toEqual(expect.objectContaining({ row: 2, status: 'FAILURE', error: expect.stringContaining('already enrolled') }));
      });
    });

    describe('bulk import (Excel)', () => {
      const headers = ['roll_number', 'subject_code', 'academic_year', 'semester'];

      beforeEach(() => {
        prisma.student.findMany.mockResolvedValue([
          { id: 'student-1', rollNumber: '1001', batchId: 'batch-A' },
          { id: 'student-2', rollNumber: '1002', batchId: 'batch-B' },
        ]);
        prisma.subject.findMany.mockResolvedValue([{ id: 'subject-DBMS', code: 'UCS301' }]);
      });

      it('template has the four columns with a fixed example row', async () => {
        const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());
        expect(Object.keys(row)).toEqual(headers);
        expect(row.subject_code).toBe('UCS301');
      });

      it("enrolls a row using the student's current batch", async () => {
        await service.bulkImport(await buildXlsxBuffer(headers, [['1002', 'UCS301', '2025-2026', 5]]), admin);

        expect(prisma.studentSubjectEnrollment.createManyAndReturn).toHaveBeenCalledWith({
          data: [{ studentId: 'student-2', subjectId: 'subject-DBMS', batchId: 'batch-B', academicYear: '2025-2026', semester: 5 }],
        });
        expect(jobResult()).toEqual(expect.objectContaining({ resourceType: 'enrollments', successCount: 1, failureCount: 0 }));
      });

      it('reports per-row failures without blocking good rows, with correct sheet row numbers', async () => {
        await service.bulkImport(
          await buildXlsxBuffer(headers, [
            ['1001', 'UCS301', '2025-2026', 5], // row 2 ok
            ['9999', 'UCS301', '2025-2026', 5], // row 3 unknown student
            ['1001', 'NOPE', '2025-2026', 5], // row 4 unknown subject
            ['1001', 'UCS301', '2025-2026', 'x'], // row 5 bad semester
            ['1001', 'UCS301', '2025-2026', 0], // row 6 semester < 1
            ['1001', 'UCS301', '', 5], // row 7 blank year
          ]),
          admin,
        );

        const { results, successCount, failureCount } = jobResult();
        expect([successCount, failureCount]).toEqual([1, 5]);
        expect(results[0]).toEqual({ row: 2, status: 'SUCCESS', id: 'enr-1' });
        expect(results[1]).toEqual(expect.objectContaining({ row: 3, status: 'FAILURE', error: expect.stringContaining("'9999' not found") }));
        expect(results[2]).toEqual(expect.objectContaining({ row: 4, error: expect.stringContaining("'NOPE' not found") }));
        expect(results[3]).toEqual(expect.objectContaining({ row: 5, error: expect.stringContaining('semester') }));
        expect(results[4]).toEqual(expect.objectContaining({ row: 6, error: expect.stringContaining('semester') }));
        expect(results[5]).toEqual(expect.objectContaining({ row: 7, error: expect.stringContaining('academic_year') }));
      });

      it('treats an already-enrolled row as a per-row FAILURE', async () => {
        prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
          { studentId: 'student-1', subjectId: 'subject-DBMS', academicYear: '2025-2026', semester: 5 },
        ]);

        await service.bulkImport(await buildXlsxBuffer(headers, [['1001', 'UCS301', '2025-2026', 5]]), admin);

        expect(jobResult().results[0]).toEqual(
          expect.objectContaining({ row: 2, status: 'FAILURE', error: expect.stringContaining('already enrolled') }),
        );
        expect(prisma.studentSubjectEnrollment.createManyAndReturn).not.toHaveBeenCalled();
      });

      it('rejects a file missing required columns outright', async () => {
        const buffer = await buildXlsxBuffer(['roll_number', 'subject_code'], [['1001', 'UCS301']]);
        await expect(service.bulkImport(buffer, admin)).rejects.toThrow('missing required column');
        expect(importJobsService.create).not.toHaveBeenCalled();
      });
    });
  });
});
