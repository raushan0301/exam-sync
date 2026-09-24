import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, FacultyAssignmentRole } from '@exam-sync/db';
import { FacultyAssignmentsService } from './faculty-assignments.service';
import { FacultyService } from '../faculty';
import { SubjectsService, BatchesService } from '../academic-structure';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    facultySubjectBatchAssignment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
  return {
    ...tx,
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('FacultyAssignmentsService — the core M:N junction (BR-007/008/009)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let facultyService: { findById: jest.Mock };
  let subjectsService: { findById: jest.Mock };
  let batchesService: { findById: jest.Mock };
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
    auditHook = { record: jest.fn() };
    facultyService = { findById: jest.fn() };
    subjectsService = { findById: jest.fn() };
    batchesService = { findById: jest.fn() };

    service = new FacultyAssignmentsService(
      prisma,
      auditHook as unknown as AuditHookService,
      facultyService as unknown as FacultyService,
      subjectsService as unknown as SubjectsService,
      batchesService as unknown as BatchesService,
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
});
