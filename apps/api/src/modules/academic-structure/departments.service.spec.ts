import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, AcademicStatus } from '@exam-sync/db';
import { DepartmentsService } from './departments.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    department: { create: jest.fn(), update: jest.fn() },
  };
  return {
    department: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };

describe('DepartmentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let service: DepartmentsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    service = new DepartmentsService(prisma, auditHook as unknown as AuditHookService);
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
});
