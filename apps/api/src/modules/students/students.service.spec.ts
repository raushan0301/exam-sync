import { ConflictException } from '@nestjs/common';
import { Prisma, AcademicStatus } from '@exam-sync/db';
import { StudentsService } from './students.service';
import { ProgramsService, BatchesService } from '../academic-structure';
import { PasswordService } from '../auth';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { StudentsAccessRepository } from './students-access.repository';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';

function buildPrismaMock() {
  const tx = {
    role: { findUnique: jest.fn() },
    user: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    userRole: { create: jest.fn() },
    student: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  return {
    ...tx,
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('StudentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let programsService: { findById: jest.Mock; findByCode: jest.Mock };
  let batchesService: { findById: jest.Mock; findByProgramYearSectionSubsection: jest.Mock };
  let passwordService: { hash: jest.Mock };
  let accessRepository: any;
  let importJobsService: { create: jest.Mock };
  let service: StudentsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    programsService = { findById: jest.fn(), findByCode: jest.fn() };
    batchesService = { findById: jest.fn(), findByProgramYearSectionSubsection: jest.fn() };
    passwordService = { hash: jest.fn().mockResolvedValue('hashed-temp-password') };
    accessRepository = {};
    importJobsService = { create: jest.fn() };

    service = new StudentsService(
      prisma,
      auditHook as unknown as AuditHookService,
      programsService as unknown as ProgramsService,
      batchesService as unknown as BatchesService,
      passwordService as unknown as PasswordService,
      accessRepository as StudentsAccessRepository,
      importJobsService as unknown as ImportJobsService,
    );
  });

  describe('generateBulkImportTemplate', () => {

    it('uses a fixed example row, independent of existing data', async () => {

      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());


      expect(row.program_code).toBe('BE-COE');

    });

  });

  describe('create', () => {
    const dto = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      program_id: 'p1',
      batch_id: 'b1',
      roll_number: 'CSE-001',
    };

    it('rejects when the batch does not belong to the given program (data-integrity check)', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      batchesService.findById.mockResolvedValue({ id: 'b1', programId: 'OTHER_PROGRAM' });

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a duplicate roll number pre-check with 409', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      batchesService.findById.mockResolvedValue({ id: 'b1', programId: 'p1' });
      prisma.student.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate email pre-check with 409', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      batchesService.findById.mockResolvedValue({ id: 'b1', programId: 'p1' });
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
    });

    it('creates User + UserRole(STUDENT) + Student atomically, never returning the password', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      batchesService.findById.mockResolvedValue({ id: 'b1', programId: 'p1' });
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-student', name: 'STUDENT' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', email: dto.email });
      const createdStudent = { id: 'student-1', name: dto.name, rollNumber: dto.roll_number };
      prisma.student.create.mockResolvedValue(createdStudent);

      const result = await service.create(dto, actor);

      expect(result).toEqual(createdStudent);
      expect(JSON.stringify(result)).not.toMatch(/password/i);
      expect(prisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', roleId: 'role-student' },
      });
      expect(passwordService.hash).toHaveBeenCalledWith('CSE-001_adalovelace');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: dto.email, passwordHash: 'hashed-temp-password', isActive: true, mustChangePassword: true },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Student' }),
        expect.anything(),
      );
    });

    it('fails clearly if the STUDENT role is not seeded (environment defect, not silently roleless)', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      batchesService.findById.mockResolvedValue({ id: 'b1', programId: 'p1' });
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('maps a raw roll_number unique-constraint DB error to 409', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      batchesService.findById.mockResolvedValue({ id: 'b1', programId: 'p1' });
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
    });
  });

  describe('update / deactivation', () => {
    it('deactivating a student also disables their linked User login (FR-005)', async () => {
      const existing = { id: 's1', userId: 'user-1', programId: 'p1', batchId: 'b1', status: AcademicStatus.ACTIVE };
      prisma.student.findUnique.mockResolvedValue(existing);
      prisma.student.update.mockResolvedValue({ ...existing, status: AcademicStatus.INACTIVE });

      await service.update('s1', { status: AcademicStatus.INACTIVE }, actor);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE' }),
        expect.anything(),
      );
    });

    it('reactivating a student re-enables their linked User login', async () => {
      const existing = { id: 's1', userId: 'user-1', programId: 'p1', batchId: 'b1', status: AcademicStatus.INACTIVE };
      prisma.student.findUnique.mockResolvedValue(existing);
      prisma.student.update.mockResolvedValue({ ...existing, status: AcademicStatus.ACTIVE });

      await service.update('s1', { status: AcademicStatus.ACTIVE }, actor);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: true },
      });
    });

    it('rejects reassignment to a batch that does not belong to the target program', async () => {
      prisma.student.findUnique.mockResolvedValue({ id: 's1', userId: 'user-1', programId: 'p1', batchId: 'b1', status: 'ACTIVE' });
      batchesService.findById.mockResolvedValue({ id: 'b2', programId: 'OTHER' });
      programsService.findById.mockResolvedValue({ id: 'OTHER', name: 'Other Program' });

      await expect(service.update('s1', { batch_id: 'b2' }, actor)).rejects.toThrow(ConflictException);
    });
  });

  describe('bulkImport', () => {
    it('processes each row independently — one bad row never blocks the rest (EC-044)', async () => {
      // Row 1 (program "BTCSE") succeeds; row 2 references a program code
      // that doesn't exist ("MISSING-PROGRAM"), so only that row fails.
      programsService.findByCode.mockImplementation((code: string) => {
        if (code === 'BTCSE') return Promise.resolve({ id: 'p1', code: 'BTCSE' });
        return Promise.resolve(null);
      });
      programsService.findById.mockResolvedValue({ id: 'p1', code: 'BTCSE' });
      batchesService.findByProgramYearSectionSubsection.mockResolvedValue({ id: 'b1', programId: 'p1' });
      batchesService.findById.mockResolvedValue({ id: 'b1', programId: 'p1' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-student', name: 'STUDENT' });
      prisma.user.create.mockResolvedValue({ id: 'user-x' });
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.student.create.mockResolvedValue({ id: 'student-ok' });

      const buffer = await buildXlsxBuffer(
        ['name', 'email', 'program_code', 'batch_year', 'batch_section', 'batch_subsection', 'roll_number'],
        [
          ['Ada', 'ada@example.com', 'BTCSE', '2026', 'A', 'A1', 'ROLL-1'],
          ['Bob', 'bob@example.com', 'MISSING-PROGRAM', '2026', 'A', 'A1', 'ROLL-2'],
        ],
      );

      let capturedResults: any;
      importJobsService.create.mockImplementation((input) => {
        capturedResults = input;
        return Promise.resolve({ id: 'job-1', ...input });
      });

      const job = await service.bulkImport(buffer, actor);

      expect(job.id).toBe('job-1');
      expect(capturedResults.totalRows).toBe(2);
      expect(capturedResults.successCount).toBe(1);
      expect(capturedResults.failureCount).toBe(1);
      expect(capturedResults.results[0]).toEqual(
        expect.objectContaining({ row: 2, status: 'SUCCESS', id: 'student-ok' }),
      );
      expect(capturedResults.results[1]).toEqual(
        expect.objectContaining({ row: 3, status: 'FAILURE', error: expect.stringContaining('MISSING-PROGRAM') }),
      );
    });

    it('reports a per-row FAILURE when the (program, year, section, subsection) batch cannot be found', async () => {
      programsService.findByCode.mockResolvedValue({ id: 'p1', code: 'BTCSE' });
      batchesService.findByProgramYearSectionSubsection.mockResolvedValue(null);
      importJobsService.create.mockResolvedValue({ id: 'job-error' });

      const buffer = await buildXlsxBuffer(
        ['name', 'email', 'program_code', 'batch_year', 'batch_section', 'batch_subsection', 'roll_number'],
        [['Ada', 'ada@example.com', 'BTCSE', '2026', 'Z', 'Z1', 'ROLL-1']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalRows: 1,
          successCount: 0,
          failureCount: 1,
          results: [expect.objectContaining({ status: 'FAILURE', error: expect.stringContaining('No batch found') })],
        }),
      );
    });
  });
});
