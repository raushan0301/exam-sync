import { ConflictException, NotFoundException } from '@nestjs/common';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';
import { Prisma, AcademicStatus } from '@exam-sync/db';
import { ProgramsService } from './programs.service';
import { DepartmentsService } from './departments.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    program: { create: jest.fn(), update: jest.fn() },
  };
  return {
    program: {
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

describe('ProgramsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let departmentsService: { findById: jest.Mock; findByCode: jest.Mock };
  let importJobsService: { create: jest.Mock };
  let service: ProgramsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    departmentsService = { findById: jest.fn(), findByCode: jest.fn() };
    importJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new ProgramsService(
      prisma,
      auditHook as unknown as AuditHookService,
      departmentsService as unknown as DepartmentsService,
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
    it('validates the department exists before creating (404 on bad dept, per API_CONTRACT.md)', async () => {
      departmentsService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.create({ department_id: 'missing-dept', name: 'B.Tech CSE', code: 'BTCSE' }, actor),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.program.create).not.toHaveBeenCalled();
    });

    it('creates a program and records an audit event when the department is valid', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1', status: 'ACTIVE' });
      const created = { id: 'p1', departmentId: 'd1', name: 'B.Tech CSE', code: 'BTCSE' };
      prisma.__tx.program.create.mockResolvedValue(created);

      const result = await service.create(
        { department_id: 'd1', name: 'B.Tech CSE', code: 'BTCSE' },
        actor,
      );

      expect(result).toEqual(created);
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Program' }),
        expect.anything(),
      );
    });

    it('maps a duplicate code DB error to 409', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.__tx.program.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(
        service.create({ department_id: 'd1', name: 'X', code: 'DUP' }, actor),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('re-validates the new department on reassignment (BR-002)', async () => {
      prisma.program.findUnique.mockResolvedValue({ id: 'p1', departmentId: 'd1', code: 'BTCSE', status: 'ACTIVE' });
      departmentsService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.update('p1', { department_id: 'missing-dept' }, actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('records DEACTIVATE when status flips to INACTIVE', async () => {
      const existing = { id: 'p1', code: 'BTCSE', status: AcademicStatus.ACTIVE };
      prisma.program.findUnique.mockResolvedValue(existing);
      prisma.__tx.program.update.mockResolvedValue({ ...existing, status: AcademicStatus.INACTIVE });

      await service.update('p1', { status: AcademicStatus.INACTIVE }, actor);

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE' }),
        expect.anything(),
      );
    });
  });

  describe('assertActiveOrThrow', () => {
    it('throws 409 for an inactive program', async () => {
      prisma.program.findUnique.mockResolvedValue({ id: 'p1', code: 'BTCSE', status: AcademicStatus.INACTIVE });
      await expect(service.assertActiveOrThrow('p1')).rejects.toThrow(ConflictException);
    });
  });

  describe('bulkImport', () => {
    it('resolves department_code to department_id and imports the row', async () => {
      departmentsService.findByCode.mockResolvedValue({ id: 'd1', code: 'CSE' });
      prisma.program.findUnique.mockResolvedValue(null);
      prisma.__tx.program.create.mockResolvedValue({ id: 'p1', code: 'BTCSE' });
      const buffer = await buildXlsxBuffer(
        ['department_code', 'code', 'name'],
        [['CSE', 'BTCSE', 'B.Tech CSE']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 1,
          failureCount: 0,
          results: [{ row: 2, status: 'SUCCESS', id: 'p1' }],
        }),
      );
    });

    it('reports a duplicate code as a per-row FAILURE', async () => {
      departmentsService.findByCode.mockResolvedValue({ id: 'd1', code: 'CSE' });
      prisma.program.findUnique.mockResolvedValue({ id: 'existing', code: 'BTCSE' });
      const buffer = await buildXlsxBuffer(
        ['department_code', 'code', 'name'],
        [['CSE', 'BTCSE', 'B.Tech CSE']],
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

    it('reports an unresolvable department_code as a per-row FAILURE', async () => {
      departmentsService.findByCode.mockResolvedValue(null);
      const buffer = await buildXlsxBuffer(
        ['department_code', 'code', 'name'],
        [['MISSING', 'BTCSE', 'B.Tech CSE']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 0,
          failureCount: 1,
          results: [expect.objectContaining({ status: 'FAILURE', error: expect.stringContaining('MISSING') })],
        }),
      );
    });
  });
});
