import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, AcademicStatus } from '@exam-sync/db';
import { BatchesService } from './batches.service';
import { ProgramsService } from './programs.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    batch: { create: jest.fn(), update: jest.fn() },
  };
  return {
    batch: {
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

describe('BatchesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let programsService: { findById: jest.Mock };
  let service: BatchesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    programsService = { findById: jest.fn() };
    service = new BatchesService(
      prisma,
      auditHook as unknown as AuditHookService,
      programsService as unknown as ProgramsService,
    );
  });

  describe('create', () => {
    it('validates the program exists before creating', async () => {
      programsService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.create({ program_id: 'missing', year: 2026, section: 'A' }, actor),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('creates a batch and records an audit event', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      const created = { id: 'b1', programId: 'p1', year: 2026, section: 'A' };
      prisma.__tx.batch.create.mockResolvedValue(created);

      const result = await service.create({ program_id: 'p1', year: 2026, section: 'A' }, actor);

      expect(result).toEqual(created);
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Batch' }),
        expect.anything(),
      );
    });

    it('maps duplicate (program_id, year, section) to 409 — BR: unique batch identity', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      prisma.__tx.batch.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(
        service.create({ program_id: 'p1', year: 2026, section: 'A' }, actor),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update / deactivation', () => {
    it('records DEACTIVATE when status flips to INACTIVE', async () => {
      const existing = { id: 'b1', year: 2026, section: 'A', status: AcademicStatus.ACTIVE };
      prisma.batch.findUnique.mockResolvedValue(existing);
      prisma.__tx.batch.update.mockResolvedValue({ ...existing, status: AcademicStatus.INACTIVE });

      await service.update('b1', { status: AcademicStatus.INACTIVE }, actor);

      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE' }),
        expect.anything(),
      );
    });
  });

  describe('assertActiveOrThrow', () => {
    it('throws 409 for an inactive batch', async () => {
      prisma.batch.findUnique.mockResolvedValue({
        id: 'b1',
        year: 2026,
        section: 'A',
        status: AcademicStatus.INACTIVE,
      });
      await expect(service.assertActiveOrThrow('b1')).rejects.toThrow(ConflictException);
    });

    it('resolves for an active batch', async () => {
      prisma.batch.findUnique.mockResolvedValue({
        id: 'b1',
        year: 2026,
        section: 'A',
        status: AcademicStatus.ACTIVE,
      });
      await expect(service.assertActiveOrThrow('b1')).resolves.toBeDefined();
    });
  });
});
