import { ConflictException, NotFoundException } from '@nestjs/common';
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
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };

describe('ProgramsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let departmentsService: { findById: jest.Mock };
  let service: ProgramsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    departmentsService = { findById: jest.fn() };
    service = new ProgramsService(
      prisma,
      auditHook as unknown as AuditHookService,
      departmentsService as unknown as DepartmentsService,
    );
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
});
