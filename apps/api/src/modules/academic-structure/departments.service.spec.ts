import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, AcademicStatus } from '@exam-sync/db';
import { DepartmentsService } from './departments.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';

function buildPrismaMock() {
  const tx = {
    department: { create: jest.fn(), update: jest.fn() },
  };
  return {
    department: {
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

describe('DepartmentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let service: DepartmentsService;

  let importJobsService: { create: jest.Mock };

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    importJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new DepartmentsService(
      prisma,
      auditHook as unknown as AuditHookService,
      importJobsService as any,
    );
  });

  describe('generateBulkImportTemplate', () => {
    it('uses a real existing department as the example row instead of a fictional placeholder', async () => {
      prisma.department.findFirst.mockResolvedValue({ id: 'd1', code: 'ECE', name: 'Electronics & Comms' });

      const buffer = await service.generateBulkImportTemplate();
      const row = await readTemplateExampleRow(buffer);

      expect(row.code).toBe('ECE');
      expect(row.name).toBe('Electronics & Comms');
    });

    it('falls back to a fictional placeholder when the table is genuinely empty', async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      const buffer = await service.generateBulkImportTemplate();
      const row = await readTemplateExampleRow(buffer);

      expect(row.code).toBe('CSE');
    });
  });

  describe('create', () => {
    it('creates a department and records an audit event', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      const created = { id: 'd1', name: 'CSE', code: 'CSE', status: 'ACTIVE' };
      prisma.__tx.department.create.mockResolvedValue(created);

      const result = await service.create({ name: 'CSE', code: 'CSE' }, actor);

      expect(result).toEqual(created);
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Department', entityId: 'd1' }),
        expect.anything(),
      );
    });

    it('pre-checks for a duplicate code and returns 409 before hitting the DB constraint', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'existing', code: 'CSE' });

      await expect(service.create({ name: 'CSE', code: 'CSE' }, actor)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.department.create).not.toHaveBeenCalled();
    });

    it('maps a raw DB unique-constraint violation (race condition) to 409 too', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      const dbError = new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'x',
      });
      prisma.__tx.department.create.mockRejectedValue(dbError);

      await expect(service.create({ name: 'CSE', code: 'CSE' }, actor)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findById', () => {
    it('throws 404 for a non-existent department', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update / deactivation', () => {
    it('records a DEACTIVATE audit action when status flips to INACTIVE', async () => {
      const existing = { id: 'd1', code: 'CSE', status: AcademicStatus.ACTIVE };
      prisma.department.findUnique.mockResolvedValue(existing);
      prisma.__tx.department.update.mockResolvedValue({ ...existing, status: AcademicStatus.INACTIVE });

      await service.update('d1', { status: AcademicStatus.INACTIVE }, actor);

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE' }),
        expect.anything(),
      );
    });

    it('records a plain UPDATE action for a non-status change', async () => {
      const existing = { id: 'd1', code: 'CSE', name: 'CSE', status: AcademicStatus.ACTIVE };
      prisma.department.findUnique.mockResolvedValue(existing);
      prisma.__tx.department.update.mockResolvedValue({ ...existing, name: 'Computer Science' });

      await service.update('d1', { name: 'Computer Science' }, actor);

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
        expect.anything(),
      );
    });
  });

  describe('assertActiveOrThrow (downstream-blocking guard)', () => {
    it('resolves for an ACTIVE department', async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'd1',
        code: 'CSE',
        status: AcademicStatus.ACTIVE,
      });
      await expect(service.assertActiveOrThrow('d1')).resolves.toBeDefined();
    });

    it('throws 409 for an INACTIVE department — this is the guard future downstream modules will call', async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'd1',
        code: 'CSE',
        status: AcademicStatus.INACTIVE,
      });
      await expect(service.assertActiveOrThrow('d1')).rejects.toThrow(ConflictException);
    });

    it('throws 404 for a non-existent department', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      await expect(service.assertActiveOrThrow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulkImport', () => {
    it('imports a valid row and records a SUCCESS job result', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      prisma.__tx.department.create.mockResolvedValue({ id: 'd1', code: 'CSE', name: 'CSE' });
      const buffer = await buildXlsxBuffer(['code', 'name'], [['CSE', 'Computer Science']]);

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'departments',
          totalRows: 1,
          successCount: 1,
          failureCount: 0,
          results: [{ row: 2, status: 'SUCCESS', id: 'd1' }],
        }),
      );
    });

    it('reports a duplicate code as a per-row FAILURE without aborting the job', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'existing', code: 'CSE' });
      const buffer = await buildXlsxBuffer(['code', 'name'], [['CSE', 'Computer Science']]);

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          totalRows: 1,
          successCount: 0,
          failureCount: 1,
          results: [expect.objectContaining({ row: 2, status: 'FAILURE' })],
        }),
      );
    });
  });
});
