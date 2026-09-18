import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, InvigilatorRole, Prisma } from '@exam-sync/db';
import { InvigilationService } from './invigilation.service';
import { ExamSessionsService } from '../exam-session';
import { FacultyService } from '../faculty';
import { ConflictEngineService } from '../conflict-engine';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

function buildPrismaMock() {
  const tx = {
    $queryRaw: jest.fn(),
    examInvigilator: { findUnique: jest.fn(), create: jest.fn() },
  };
  return {
    examSessionRoom: { findUnique: jest.fn() },
    examInvigilator: { findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: [ROLE.ADMIN] };
const facultyActor: AuthenticatedUser = { id: 'user-fac-1', email: 'f@example.com', roles: [ROLE.FACULTY] };
const studentActor: AuthenticatedUser = { id: 'user-stu-1', email: 's@example.com', roles: [ROLE.STUDENT] };

const activeSession = {
  id: 's1',
  status: ExamSessionStatus.SEATING_GENERATION,
  sessionDate: new Date('2026-05-01'),
  startTime: new Date('1970-01-01T10:00:00Z'),
  endTime: new Date('1970-01-01T11:00:00Z'),
};

describe('InvigilationService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let examSessionsService: { findById: jest.Mock };
  let facultyService: { findById: jest.Mock; findByUserId: jest.Mock };
  let conflictEngine: { checkInvigilatorAssignment: jest.Mock };
  let service: InvigilationService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    examSessionsService = { findById: jest.fn() };
    facultyService = { findById: jest.fn(), findByUserId: jest.fn() };
    conflictEngine = { checkInvigilatorAssignment: jest.fn() };

    service = new InvigilationService(
      prisma,
      auditHook as unknown as AuditHookService,
      examSessionsService as unknown as ExamSessionsService,
      facultyService as unknown as FacultyService,
      conflictEngine as unknown as ConflictEngineService,
    );
  });

  describe('assign — BR-030 (any subject), BR-020/BR-031 (overlap), FR-035', () => {
    const dto = { room_id: 'room-1', faculty_id: 'fac-1', role: InvigilatorRole.LEAD_INVIGILATOR };

    it('rejects assigning to a CANCELLED session with 409', async () => {
      examSessionsService.findById.mockResolvedValue({ ...activeSession, status: ExamSessionStatus.CANCELLED });

      await expect(service.assign('s1', dto, admin)).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the target room is not allocated to this session', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examSessionRoom.findUnique.mockResolvedValue(null);

      await expect(service.assign('s1', dto, admin)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the faculty does not exist', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.assign('s1', dto, admin)).rejects.toThrow(NotFoundException);
    });

    it('locks the faculty row before checking/inserting (ADR-003-style concurrency guard)', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1' });
      prisma.__tx.$queryRaw.mockResolvedValue([{ id: 'fac-1' }]);
      prisma.__tx.examInvigilator.findUnique.mockResolvedValue(null);
      conflictEngine.checkInvigilatorAssignment.mockResolvedValue({ hard: [], warnings: [] });
      prisma.__tx.examInvigilator.create.mockResolvedValue({ id: 'inv-1', ...dto, examSessionId: 's1' });

      await service.assign('s1', dto, admin);

      expect(prisma.__tx.$queryRaw).toHaveBeenCalled();
      const sqlCall = prisma.__tx.$queryRaw.mock.calls[0][0];
      expect(sqlCall.values).toContain('fac-1');
      expect(conflictEngine.checkInvigilatorAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ facultyId: 'fac-1', examSessionId: 's1', roomId: 'room-1' }),
        prisma.__tx,
      );
    });

    it('409s when the exact (session, room, faculty) triple already exists — "already assigned", not a conflict-engine hit', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1' });
      prisma.__tx.$queryRaw.mockResolvedValue([{ id: 'fac-1' }]);
      prisma.__tx.examInvigilator.findUnique.mockResolvedValue({ id: 'existing-inv' });

      await expect(service.assign('s1', dto, admin)).rejects.toThrow(ConflictException);
      expect(conflictEngine.checkInvigilatorAssignment).not.toHaveBeenCalled();
      expect(prisma.__tx.examInvigilator.create).not.toHaveBeenCalled();
    });

    it('409s with BR-031 details when the Conflict Engine reports a FACULTY_OVERLAP', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1' });
      prisma.__tx.$queryRaw.mockResolvedValue([{ id: 'fac-1' }]);
      prisma.__tx.examInvigilator.findUnique.mockResolvedValue(null);
      conflictEngine.checkInvigilatorAssignment.mockResolvedValue({
        hard: [{ type: 'FACULTY_OVERLAP', facultyId: 'fac-1', message: 'overlap' }],
        warnings: [],
      });

      await expect(service.assign('s1', dto, admin)).rejects.toThrow(ConflictException);
      expect(prisma.__tx.examInvigilator.create).not.toHaveBeenCalled();
    });

    it('creates the invigilator assignment and audits it when everything checks out', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1' });
      prisma.__tx.$queryRaw.mockResolvedValue([{ id: 'fac-1' }]);
      prisma.__tx.examInvigilator.findUnique.mockResolvedValue(null);
      conflictEngine.checkInvigilatorAssignment.mockResolvedValue({ hard: [], warnings: [] });
      const created = { id: 'inv-1', examSessionId: 's1', roomId: 'room-1', facultyId: 'fac-1', role: dto.role };
      prisma.__tx.examInvigilator.create.mockResolvedValue(created);

      const result = await service.assign('s1', dto, admin);

      expect(result).toEqual(created);
      expect(prisma.__tx.examInvigilator.create).toHaveBeenCalledWith({
        data: { examSessionId: 's1', roomId: 'room-1', facultyId: 'fac-1', role: dto.role },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'ExamInvigilator', entityId: 'inv-1' }),
        expect.anything(),
      );
    });

    it('maps a concurrent unique-constraint race (P2002) to a clean 409, never a raw 500 (ADR-003 backstop)', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1' });
      prisma.$transaction.mockRejectedValue(p2002());

      await expect(service.assign('s1', dto, admin)).rejects.toThrow(ConflictException);
    });

    it('lets an unrelated transaction error propagate unmapped', async () => {
      examSessionsService.findById.mockResolvedValue(activeSession);
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examSessionRoom.findUnique.mockResolvedValue({ id: 'esr-1' });
      const genuinelyUnexpected = new Error('db exploded');
      prisma.$transaction.mockRejectedValue(genuinelyUnexpected);

      await expect(service.assign('s1', dto, admin)).rejects.toBe(genuinelyUnexpected);
    });
  });

  describe('listDuties — self/ADMIN, 404-not-403 (BR-045-style IDOR posture)', () => {
    it('ADMIN can list any faculty\'s duties', async () => {
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findMany.mockResolvedValue([]);

      const result = await service.listDuties('fac-1', admin, {});

      expect(result.items).toEqual([]);
      expect(facultyService.findByUserId).not.toHaveBeenCalled();
    });

    it('404s for ADMIN when the target faculty does not exist', async () => {
      facultyService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.listDuties('missing', admin, {})).rejects.toThrow(NotFoundException);
    });

    it('a faculty can list their OWN duties', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findMany.mockResolvedValue([{ id: 'inv-1' }]);

      const result = await service.listDuties('fac-1', facultyActor, {});

      expect(result.items).toHaveLength(1);
    });

    it('404s (not 403) when a faculty tries to list a DIFFERENT faculty\'s duties', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });

      await expect(service.listDuties('fac-2', facultyActor, {})).rejects.toThrow(NotFoundException);
    });

    it('404s for a non-faculty actor (e.g. a student) regardless of the id requested', async () => {
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.listDuties('fac-1', studentActor, {})).rejects.toThrow(NotFoundException);
    });

    it('cursor-paginates using the shared pagination helpers', async () => {
      facultyService.findById.mockResolvedValue({ id: 'fac-1' });
      const rows = Array.from({ length: 26 }, (_, i) => ({ id: `inv${i}` }));
      prisma.examInvigilator.findMany.mockResolvedValue(rows);

      const result = await service.listDuties('fac-1', admin, {});

      expect(result.items).toHaveLength(25);
      expect(result.next_cursor).toBe('inv24');
    });
  });
});
