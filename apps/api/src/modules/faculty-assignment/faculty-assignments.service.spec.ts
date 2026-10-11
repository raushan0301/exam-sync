import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, FacultyAssignmentRole } from '@exam-sync/db';
import { FacultyAssignmentsService } from './faculty-assignments.service';
import { FacultyService } from '../faculty';
import { SubjectsService, BatchesService } from '../academic-structure';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';

function buildPrismaMock() {
  const tx = {
    facultySubjectBatchAssignment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      createManyAndReturn: jest.fn(),
    },
  };
  return {
    ...tx,
    faculty: { findMany: jest.fn().mockResolvedValue([]) },
    subject: { findMany: jest.fn().mockResolvedValue([]) },
    program: { findMany: jest.fn().mockResolvedValue([]) },
    batch: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('FacultyAssignmentsService — the core M:N junction (BR-007/008/009)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock; recordMany: jest.Mock };
  let facultyService: { findById: jest.Mock };
  let subjectsService: { findById: jest.Mock };
  let batchesService: { findById: jest.Mock };
  let importJobsService: { create: jest.Mock };
  let service: FacultyAssignmentsService;

  const dto = {
    faculty_id: 'faculty-A',
    subject_id: 'subject-DBMS',
    batch_id: 'batch-A',
    academic_year: '2026',
    semester: 1,
    role: FacultyAssignmentRole.PRIMARY_INSTRUCTOR,
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn(), recordMany: jest.fn() };
    facultyService = { findById: jest.fn() };
    subjectsService = { findById: jest.fn() };
    batchesService = { findById: jest.fn() };
    importJobsService = { create: jest.fn() };

    service = new FacultyAssignmentsService(
      prisma,
      auditHook as unknown as AuditHookService,
      facultyService as unknown as FacultyService,
      subjectsService as unknown as SubjectsService,
      batchesService as unknown as BatchesService,
      importJobsService as unknown as ImportJobsService,
    );
  });

  describe('create', () => {
    it('validates faculty, subject, and batch all exist before creating', async () => {
      facultyService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.create(dto, actor)).rejects.toThrow(NotFoundException);
      expect(prisma.facultySubjectBatchAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects an exact duplicate (faculty, subject, batch, year, semester) with 409 — BR-009', async () => {
      facultyService.findById.mockResolvedValue({ id: 'faculty-A' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
      expect(prisma.facultySubjectBatchAssignment.create).not.toHaveBeenCalled();
    });

    it('creates the assignment and audits it', async () => {
      facultyService.findById.mockResolvedValue({ id: 'faculty-A' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValue(null);
      const created = { id: 'assignment-1', ...dto };
      prisma.facultySubjectBatchAssignment.create.mockResolvedValue(created);

      const result = await service.create(dto, actor);

      expect(result).toEqual(created);
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'FacultySubjectBatchAssignment' }),
        expect.anything(),
      );
    });

    it('maps a raw DB unique-constraint violation (race condition) to 409', async () => {
      facultyService.findById.mockResolvedValue({ id: 'faculty-A' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValue(null);
      prisma.facultySubjectBatchAssignment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
    });

    it('BR-008: the SAME faculty may hold assignment rows for the same subject across MULTIPLE batches', async () => {
      facultyService.findById.mockResolvedValue({ id: 'faculty-A' });
      subjectsService.findById.mockResolvedValue({ id: 'subject-DBMS' });
      batchesService.findById.mockResolvedValue({ id: 'batch-A' });
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValue(null);
      prisma.facultySubjectBatchAssignment.create.mockResolvedValue({ id: 'a1', ...dto });

      // Faculty A / DBMS / Batch A
      await service.create(dto, actor);
      // Faculty A / DBMS / Batch B — different batch_id, same faculty+subject.
      batchesService.findById.mockResolvedValue({ id: 'batch-B' });
      prisma.facultySubjectBatchAssignment.create.mockResolvedValue({
        id: 'a2',
        ...dto,
        batch_id: 'batch-B',
      });
      await expect(service.create({ ...dto, batch_id: 'batch-B' }, actor)).resolves.toBeDefined();

      expect(prisma.facultySubjectBatchAssignment.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('end (soft delete — API_CONTRACT.md: "sets an end date, does not hard-delete")', () => {
    it('sets endedAt rather than deleting the row', async () => {
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValue({ id: 'a1', endedAt: null });
      prisma.facultySubjectBatchAssignment.update.mockResolvedValue({ id: 'a1', endedAt: new Date() });

      const result = await service.end('a1', actor);

      expect(prisma.facultySubjectBatchAssignment.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { endedAt: expect.any(Date) },
      });
      expect(result.endedAt).toBeDefined();
    });

    it('rejects ending an already-ended assignment', async () => {
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValue({
        id: 'a1',
        endedAt: new Date(),
      });

      await expect(service.end('a1', actor)).rejects.toThrow(ConflictException);
    });

    it('404s for a non-existent assignment', async () => {
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValue(null);
      await expect(service.end('missing', actor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('isFacultyTeachingBatch (cross-module authorization helper)', () => {
    it('returns true when an active assignment exists for that faculty user + batch', async () => {
      prisma.facultySubjectBatchAssignment.count.mockResolvedValue(1);
      await expect(service.isFacultyTeachingBatch('faculty-user-1', 'batch-A')).resolves.toBe(true);
      expect(prisma.facultySubjectBatchAssignment.count).toHaveBeenCalledWith({
        where: { batchId: 'batch-A', endedAt: null, faculty: { userId: 'faculty-user-1' } },
      });
    });

    it('returns false when no active assignment exists', async () => {
      prisma.facultySubjectBatchAssignment.count.mockResolvedValue(0);
      await expect(service.isFacultyTeachingBatch('faculty-user-1', 'batch-A')).resolves.toBe(false);
    });
  });

  describe('bulk import (Excel) and bulk create (form) — batched', () => {
    const headers = [
      'employee_code', 'subject_code', 'program_code', 'batch_year', 'batch_section', 'batch_subsection',
      'academic_year', 'semester', 'role',
    ];
    const goodRow = ['E1', 'UCS301', 'BE-COE', '2023-2027', '4C2', '4C24', '2025-2026', 5, 'PRIMARY_INSTRUCTOR'];
    const jobResult = () => importJobsService.create.mock.calls[0][0];
    const created = () => prisma.facultySubjectBatchAssignment.createManyAndReturn;

    beforeEach(() => {
      prisma.faculty.findMany.mockResolvedValue([{ id: 'fac-1', employeeCode: 'E1' }]);
      prisma.subject.findMany.mockResolvedValue([{ id: 'sub-1', code: 'UCS301' }]);
      prisma.program.findMany.mockResolvedValue([{ id: 'prog-1', code: 'BE-COE' }]);
      prisma.batch.findMany.mockResolvedValue([
        { id: 'batch-1', programId: 'prog-1', year: '2023-2027', section: '4C2', subsection: '4C24' },
      ]);
      prisma.facultySubjectBatchAssignment.findMany.mockResolvedValue([]); // nothing assigned yet
      created().mockImplementation(({ data }: any) =>
        Promise.resolve(data.map((d: any, i: number) => ({ id: `asg-${i + 1}`, ...d }))),
      );
    });

    it('template has the nine columns with a fixed example row', async () => {
      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());
      expect(Object.keys(row)).toEqual(headers);
      expect(row.role).toBe('PRIMARY_INSTRUCTOR');
    });

    it('creates an assignment from a row, resolving faculty by employee code and the batch by program/year/section/subsection', async () => {
      await service.bulkImport(await buildXlsxBuffer(headers, [goodRow]), actor);

      expect(created()).toHaveBeenCalledWith({
        data: [
          {
            facultyId: 'fac-1', subjectId: 'sub-1', batchId: 'batch-1',
            academicYear: '2025-2026', semester: 5, role: FacultyAssignmentRole.PRIMARY_INSTRUCTOR,
          },
        ],
      });
      expect(jobResult()).toEqual(expect.objectContaining({ resourceType: 'faculty-assignments', successCount: 1, failureCount: 0 }));
    });

    it('accepts PRIMARY / CO and lowercase role aliases', async () => {
      // different batches would be needed to avoid in-file duplicates, so vary the semester instead
      await service.bulkImport(
        await buildXlsxBuffer(headers, [[...goodRow.slice(0, 7), 1, 'co'], [...goodRow.slice(0, 7), 2, 'Primary']]),
        actor,
      );
      const roles = created().mock.calls[0][0].data.map((d: any) => d.role);
      expect(roles).toEqual([FacultyAssignmentRole.CO_INSTRUCTOR, FacultyAssignmentRole.PRIMARY_INSTRUCTOR]);
    });

    it('fails each bad row with a specific message and keeps the good ones', async () => {
      const buffer = await buildXlsxBuffer(headers, [
        goodRow, // row 2 ok
        ['NOPE', ...goodRow.slice(1)], // row 3 unknown faculty
        [goodRow[0], 'NOPE', ...goodRow.slice(2)], // row 4 unknown subject
        [...goodRow.slice(0, 2), 'NOPE', ...goodRow.slice(3)], // row 5 unknown program
        [...goodRow.slice(0, 5), '9Z9', ...goodRow.slice(6)], // row 6 unknown batch
        [...goodRow.slice(0, 7), 'x', goodRow[8]], // row 7 bad semester
        [...goodRow.slice(0, 8), 'BOSS'], // row 8 bad role
        [...goodRow.slice(0, 6), '', 5, goodRow[8]], // row 9 blank year
      ]);

      await service.bulkImport(buffer, actor);

      const { results, successCount, failureCount } = jobResult();
      expect(successCount).toBe(1);
      expect(failureCount).toBe(7);
      const err = (row: number) => results.find((r: any) => r.row === row).error;
      expect(err(3)).toContain("Employee code 'NOPE' not found");
      expect(err(4)).toContain("Subject code 'NOPE' not found");
      expect(err(5)).toContain("Program code 'NOPE' not found");
      expect(err(6)).toContain('No batch found');
      expect(err(7)).toContain("'semester'");
      expect(err(8)).toContain("'role' must be PRIMARY_INSTRUCTOR or CO_INSTRUCTOR");
      expect(err(9)).toContain("'academic_year'");
    });

    it('names the existing assignment when a row already exists in the database', async () => {
      prisma.facultySubjectBatchAssignment.findMany.mockResolvedValue([
        { facultyId: 'fac-1', subjectId: 'sub-1', batchId: 'batch-1', academicYear: '2025-2026', semester: 5 },
      ]);

      await service.bulkImport(await buildXlsxBuffer(headers, [goodRow]), actor);

      expect(jobResult().results[0]).toEqual({
        row: 2,
        status: 'FAILURE',
        error: 'Already assigned: E1 → UCS301 · BE-COE 2023-2027 4C2/4C24 · 2025-2026 sem 5.',
      });
      expect(created()).not.toHaveBeenCalled();
    });

    it('a repeat of the same assignment later in the SAME file fails as already assigned', async () => {
      await service.bulkImport(await buildXlsxBuffer(headers, [goodRow, goodRow]), actor);

      const { results } = jobResult();
      expect(results[0]).toEqual(expect.objectContaining({ row: 2, status: 'SUCCESS' }));
      expect(results[1]).toEqual(expect.objectContaining({ row: 3, status: 'FAILURE', error: expect.stringContaining('Already assigned') }));
      expect(created().mock.calls[0][0].data).toHaveLength(1);
    });

    it('rejects a file missing required columns outright', async () => {
      const buffer = await buildXlsxBuffer(['employee_code', 'subject_code'], [['E1', 'UCS301']]);
      await expect(service.bulkImport(buffer, actor)).rejects.toThrow('missing required column');
      expect(importJobsService.create).not.toHaveBeenCalled();
    });

    it('uses a FIXED number of queries for 50 rows: one duplicate lookup, one insert, one audit write', async () => {
      const many = Array.from({ length: 50 }, (_, i) => [...goodRow.slice(0, 7), i + 1, goodRow[8]]);

      await service.bulkImport(await buildXlsxBuffer(headers, many), actor);

      expect(jobResult().successCount).toBe(50);
      expect(prisma.facultySubjectBatchAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(created()).toHaveBeenCalledTimes(1);
      expect(auditHook.recordMany).toHaveBeenCalledTimes(1);
      expect(auditHook.recordMany.mock.calls[0][0]).toHaveLength(50); // still one audit row per assignment
      // none of the old per-row calls
      expect(prisma.facultySubjectBatchAssignment.create).not.toHaveBeenCalled();
      expect(prisma.facultySubjectBatchAssignment.findUnique).not.toHaveBeenCalled();
      expect(facultyService.findById).not.toHaveBeenCalled();
      expect(auditHook.record).not.toHaveBeenCalled();
    });

    it('falls back to row-by-row when the batched insert fails, so only the offender fails', async () => {
      created().mockRejectedValue(new Error('unique violation'));
      facultyService.findById.mockResolvedValue({});
      subjectsService.findById.mockResolvedValue({});
      batchesService.findById.mockResolvedValue({});
      prisma.facultySubjectBatchAssignment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'raced' });
      prisma.facultySubjectBatchAssignment.create.mockResolvedValue({ id: 'asg-fallback' });

      await service.bulkImport(
        await buildXlsxBuffer(headers, [[...goodRow.slice(0, 7), 1, goodRow[8]], [...goodRow.slice(0, 7), 2, goodRow[8]]]),
        actor,
      );

      const { results } = jobResult();
      expect(results[0]).toEqual({ row: 2, status: 'SUCCESS', id: 'asg-fallback' });
      expect(results[1]).toEqual(expect.objectContaining({ row: 3, status: 'FAILURE', error: expect.stringContaining('Already assigned') }));
    });

    describe('bulkCreate (form)', () => {
      beforeEach(() => {
        prisma.faculty.findMany.mockResolvedValue([{ id: 'faculty-A', employeeCode: 'E1' }]);
        prisma.subject.findMany.mockResolvedValue([{ id: 'subject-DBMS', code: 'UCS310' }]);
        prisma.batch.findMany.mockResolvedValue([
          { id: 'batch-A', year: '2024-2028', section: '3C7', subsection: '3C71' },
          { id: 'batch-B', year: '2024-2028', section: '3C7', subsection: '3C72' },
        ]);
      });

      it('one row per batch; a duplicate fails with the batch named', async () => {
        prisma.facultySubjectBatchAssignment.findMany.mockResolvedValue([
          { facultyId: 'faculty-A', subjectId: 'subject-DBMS', batchId: 'batch-B', academicYear: '2026', semester: 1 },
        ]);

        await service.bulkCreate([dto, { ...dto, batch_id: 'batch-B' }], actor);

        const { results, successCount, failureCount } = jobResult();
        expect([successCount, failureCount]).toEqual([1, 1]);
        expect(results[0]).toEqual({ row: 1, status: 'SUCCESS', id: 'asg-1' });
        expect(results[1]).toEqual({
          row: 2,
          status: 'FAILURE',
          error: 'Already assigned: E1 → UCS310 · 2024-2028 3C7/3C72 · 2026 sem 1.',
        });
      });

      it('rejects unknown faculty / subject / batch ids per row with a clear message', async () => {
        await service.bulkCreate(
          [{ ...dto, faculty_id: 'ghost' }, { ...dto, subject_id: 'ghost' }, { ...dto, batch_id: 'ghost' }],
          actor,
        );

        const { results } = jobResult();
        expect(results.map((r: any) => r.error)).toEqual(['Faculty member not found', 'Subject not found', 'Batch not found']);
      });
    });
  });
});
