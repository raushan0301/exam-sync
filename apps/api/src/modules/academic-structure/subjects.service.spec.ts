import { ConflictException, NotFoundException } from '@nestjs/common';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';
import { Prisma } from '@exam-sync/db';
import { SubjectsService } from './subjects.service';
import { DepartmentsService } from './departments.service';
import { ProgramsService } from './programs.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    subject: { create: jest.fn(), update: jest.fn() },
  };
  return {
    subject: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('SubjectsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let departmentsService: { findById: jest.Mock; findByCode: jest.Mock };
  let programsService: { findById: jest.Mock; findByCode: jest.Mock };
  let importJobsService: { create: jest.Mock };
  let service: SubjectsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    departmentsService = { findById: jest.fn(), findByCode: jest.fn() };
    programsService = { findById: jest.fn(), findByCode: jest.fn() };
    importJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new SubjectsService(
      prisma,
      auditHook as unknown as AuditHookService,
      departmentsService as unknown as DepartmentsService,
      programsService as unknown as ProgramsService,
      importJobsService as any,
    );
  });

  describe('generateBulkImportTemplate', () => {

    it('uses a fixed example row, independent of existing data', async () => {

      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());


      expect(row.department_code).toBe('CSED');

    });

  });

  describe('create', () => {
    it('validates the department exists', async () => {
      departmentsService.findById.mockRejectedValue(new NotFoundException());
      await expect(
        service.create({ department_id: 'missing', code: 'DBMS', name: 'DBMS' }, actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('validates program_id ONLY when provided (it is nullable per ARCHITECTURE.md §AC)', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.__tx.subject.create.mockResolvedValue({ id: 's1', code: 'DBMS' });

      await service.create({ department_id: 'd1', code: 'DBMS', name: 'DBMS' }, actor);

      expect(programsService.findById).not.toHaveBeenCalled();
    });

    it('validates the program when program_id IS provided', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      programsService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.create(
          { department_id: 'd1', program_id: 'missing-program', code: 'DBMS', name: 'DBMS' },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a subject and records an audit event', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      const created = { id: 's1', departmentId: 'd1', code: 'DBMS', name: 'Databases', isActive: true };
      prisma.__tx.subject.create.mockResolvedValue(created);

      const result = await service.create(
        { department_id: 'd1', code: 'DBMS', name: 'Databases' },
        actor,
      );

      expect(result).toEqual(created);
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Subject' }),
        expect.anything(),
      );
    });

    it('maps duplicate code to 409', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.__tx.subject.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(
        service.create({ department_id: 'd1', code: 'DBMS', name: 'Databases' }, actor),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update / deactivation (boolean is_active, not the shared status enum)', () => {
    it('records DEACTIVATE when is_active flips false', async () => {
      const existing = { id: 's1', code: 'DBMS', isActive: true };
      prisma.subject.findUnique.mockResolvedValue(existing);
      prisma.__tx.subject.update.mockResolvedValue({ ...existing, isActive: false });

      await service.update('s1', { is_active: false }, actor);

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE' }),
        expect.anything(),
      );
    });

    it('records REACTIVATE when is_active flips true', async () => {
      const existing = { id: 's1', code: 'DBMS', isActive: false };
      prisma.subject.findUnique.mockResolvedValue(existing);
      prisma.__tx.subject.update.mockResolvedValue({ ...existing, isActive: true });

      await service.update('s1', { is_active: true }, actor);

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REACTIVATE' }),
        expect.anything(),
      );
    });
  });

  describe('assertActiveOrThrow', () => {
    it('throws 409 for an inactive subject', async () => {
      prisma.subject.findUnique.mockResolvedValue({ id: 's1', code: 'DBMS', isActive: false });
      await expect(service.assertActiveOrThrow('s1')).rejects.toThrow(ConflictException);
    });

    it('resolves for an active subject', async () => {
      prisma.subject.findUnique.mockResolvedValue({ id: 's1', code: 'DBMS', isActive: true });
      await expect(service.assertActiveOrThrow('s1')).resolves.toBeDefined();
    });
  });

  describe('bulkImport', () => {
    it('resolves department_code (required) and program_code (optional) and imports the row', async () => {
      departmentsService.findByCode.mockResolvedValue({ id: 'd1', code: 'CSE' });
      programsService.findByCode.mockResolvedValue({ id: 'p1', code: 'BTCSE' });
      prisma.subject.findUnique.mockResolvedValue(null);
      prisma.__tx.subject.create.mockResolvedValue({ id: 's1', code: 'CS301' });
      const buffer = await buildXlsxBuffer(
        ['department_code', 'program_code', 'code', 'name', 'credits'],
        [['CSE', 'BTCSE', 'CS301', 'Data Structures', 4]],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 1,
          failureCount: 0,
          results: [{ row: 2, status: 'SUCCESS', id: 's1' }],
        }),
      );
    });

    it('accepts a half-credit value like 3.5 (credits is a float, not an integer)', async () => {
      departmentsService.findByCode.mockResolvedValue({ id: 'd1', code: 'CSE' });
      prisma.subject.findUnique.mockResolvedValue(null);
      prisma.__tx.subject.create.mockResolvedValue({ id: 's2', code: 'CS302' });
      const buffer = await buildXlsxBuffer(
        ['department_code', 'code', 'name', 'credits'],
        [['CSE', 'CS302', 'Lab Work', 3.5]],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ successCount: 1, failureCount: 0 }),
      );
    });

    it('reports a duplicate subject code as a per-row FAILURE', async () => {
      departmentsService.findByCode.mockResolvedValue({ id: 'd1', code: 'CSE' });
      prisma.subject.findUnique.mockResolvedValue({ id: 'existing', code: 'CS301' });
      const buffer = await buildXlsxBuffer(
        ['department_code', 'code', 'name'],
        [['CSE', 'CS301', 'Data Structures']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 0,
          failureCount: 1,
          results: [expect.objectContaining({ row: 2, status: 'FAILURE' })],
        }),
      );
    });
  });
});
