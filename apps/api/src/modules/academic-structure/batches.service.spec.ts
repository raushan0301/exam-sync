import { ConflictException, NotFoundException } from '@nestjs/common';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';
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
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('BatchesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let programsService: { findById: jest.Mock; findByCode: jest.Mock };
  let importJobsService: { create: jest.Mock };
  let service: BatchesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    programsService = { findById: jest.fn(), findByCode: jest.fn() };
    importJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new BatchesService(
      prisma,
      auditHook as unknown as AuditHookService,
      programsService as unknown as ProgramsService,
      importJobsService as any,
    );
  });

  describe('generateBulkImportTemplate', () => {
    it('uses a real existing batch (+ its program\'s real code) as the example row', async () => {
      prisma.batch.findFirst.mockResolvedValue({ year: '2026', section: '2C1', subsection: '2C11', program: { code: 'BTECH-CIVIL' } });

      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());

      expect(row.program_code).toBe('BTECH-CIVIL');
      expect(row.subsection).toBe('2C11');
    });

    it('falls back to a fictional placeholder when the table is genuinely empty', async () => {
      prisma.batch.findFirst.mockResolvedValue(null);

      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());

      expect(row.program_code).toBe('BE-COE');
    });
  });

  describe('create', () => {
    it('validates the program exists before creating', async () => {
      programsService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.create({ program_id: 'missing', year: '2026', section: 'A', subsection: 'A' }, actor),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('creates a batch and records an audit event', async () => {
      programsService.findById.mockResolvedValue({ id: 'p1' });
      const created = { id: 'b1', programId: 'p1', year: '2026', section: 'A', subsection: 'A' };
      prisma.__tx.batch.create.mockResolvedValue(created);

      const result = await service.create({ program_id: 'p1', year: '2026', section: 'A', subsection: 'A' }, actor);

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
        service.create({ program_id: 'p1', year: '2026', section: 'A', subsection: 'A' }, actor),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update / deactivation', () => {
    it('records DEACTIVATE when status flips to INACTIVE', async () => {
      const existing = { id: 'b1', year: '2026', section: 'A', subsection: 'A', status: AcademicStatus.ACTIVE };
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
        year: '2026',
        section: 'A',
        subsection: 'A',
        status: AcademicStatus.INACTIVE,
      });
      await expect(service.assertActiveOrThrow('b1')).rejects.toThrow(ConflictException);
    });

    it('resolves for an active batch', async () => {
      prisma.batch.findUnique.mockResolvedValue({
        id: 'b1',
        year: '2026',
        section: 'A',
        subsection: 'A',
        status: AcademicStatus.ACTIVE,
      });
      await expect(service.assertActiveOrThrow('b1')).resolves.toBeDefined();
    });
  });

  describe('bulkImport', () => {
    it('resolves program_code to program_id and imports the row', async () => {
      programsService.findByCode.mockResolvedValue({ id: 'p1', code: 'BTCSE' });
      prisma.batch.findUnique.mockResolvedValue(null);
      prisma.__tx.batch.create.mockResolvedValue({ id: 'b1', year: '2026', section: 'A', subsection: 'A1' });
      const buffer = await buildXlsxBuffer(
        ['program_code', 'year', 'section', 'subsection'],
        [['BTCSE', '2026', 'A', 'A1']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 1,
          failureCount: 0,
          results: [{ row: 2, status: 'SUCCESS', id: 'b1' }],
        }),
      );
    });

    it('accepts a year span label like "2023-2027" (year is a free-form string, not an integer)', async () => {
      programsService.findByCode.mockResolvedValue({ id: 'p1', code: 'BTCSE' });
      prisma.batch.findUnique.mockResolvedValue(null);
      prisma.__tx.batch.create.mockResolvedValue({ id: 'b2', year: '2023-2027', section: 'A', subsection: 'A1' });
      const buffer = await buildXlsxBuffer(
        ['program_code', 'year', 'section', 'subsection'],
        [['BTCSE', '2023-2027', 'A', 'A1']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ successCount: 1, failureCount: 0 }),
      );
    });

    it('reports an existing (program, year, section, subsection) combination as a per-row FAILURE', async () => {
      programsService.findByCode.mockResolvedValue({ id: 'p1', code: 'BTCSE' });
      prisma.batch.findUnique.mockResolvedValue({ id: 'existing', year: '2026', section: 'A', subsection: 'A1' });
      const buffer = await buildXlsxBuffer(
        ['program_code', 'year', 'section', 'subsection'],
        [['BTCSE', '2026', 'A', 'A1']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 0,
          failureCount: 1,
          results: [expect.objectContaining({ row: 2, status: 'FAILURE', error: expect.stringContaining('already exists') })],
        }),
      );
    });

    it('rejects a file missing the required subsection column with a file-level error', async () => {
      const buffer = await buildXlsxBuffer(['program_code', 'year', 'section'], [['BTCSE', '2026', 'A']]);

      await expect(service.bulkImport(buffer, actor)).rejects.toThrow(/subsection/);
    });
  });
});
