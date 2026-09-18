import { ConflictException, ForbiddenException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AttendanceMethod, AttendanceStatus, ExamSessionStatus, Prisma } from '@exam-sync/db';
import { AttendanceService } from './attendance.service';
import { ExamSessionsService } from '../exam-session';
import { FacultyService } from '../faculty';
import { StudentsService } from '../students';
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
    attendance: { update: jest.fn(), create: jest.fn() },
    attendanceHistory: { create: jest.fn() },
  };
  return {
    quizStudentAssignment: { findFirst: jest.fn() },
    attendance: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    seatingAssignment: { findFirst: jest.fn() },
    examInvigilator: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: [ROLE.ADMIN] };
const facultyActor: AuthenticatedUser = { id: 'user-fac-1', email: 'f@example.com', roles: [ROLE.FACULTY] };
const otherFacultyActor: AuthenticatedUser = { id: 'user-fac-2', email: 'f2@example.com', roles: [ROLE.FACULTY] };

const inProgressSession = { id: 's1', status: ExamSessionStatus.IN_PROGRESS };

describe('AttendanceService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let examSessionsService: { findById: jest.Mock };
  let facultyService: { findByUserId: jest.Mock };
  let studentsService: { findById: jest.Mock };
  let service: AttendanceService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    examSessionsService = { findById: jest.fn() };
    facultyService = { findByUserId: jest.fn() };
    studentsService = { findById: jest.fn() };

    service = new AttendanceService(
      prisma,
      auditHook as unknown as AuditHookService,
      examSessionsService as unknown as ExamSessionsService,
      facultyService as unknown as FacultyService,
      studentsService as unknown as StudentsService,
    );
  });

  describe('mark — BR-032/033/036, invigilator-of-record (FR-037)', () => {
    const dto = { student_id: 'stu-1', status: AttendanceStatus.PRESENT, method: AttendanceMethod.SEAT_BASED };

    it('rejects marking for a CANCELLED session with 409 (BR-036)', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.CANCELLED });

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(ConflictException);
    });

    it('422s when the session is not IN_PROGRESS (BR-032)', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: ExamSessionStatus.SEATING_GENERATION });

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('404s when the student has no active ASSIGNED assignment in this session', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.quizStudentAssignment.findFirst.mockResolvedValue(null);

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(NotFoundException);
    });

    it('409s when attendance already exists for this assignment (BR-033/EC-027)', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.quizStudentAssignment.findFirst.mockResolvedValue({ id: 'qsa-1', quizId: 'quiz-1' });
      prisma.attendance.findUnique.mockResolvedValue({ id: 'existing-att' });

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(ConflictException);
      expect(prisma.__tx.attendance.create).not.toHaveBeenCalled();
    });

    it('409s when no finalized seat assignment exists for the student', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.quizStudentAssignment.findFirst.mockResolvedValue({ id: 'qsa-1', quizId: 'quiz-1' });
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.seatingAssignment.findFirst.mockResolvedValue(null);

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(ConflictException);
    });

    it('403s when the acting faculty is not the invigilator-of-record for the student\'s room', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.quizStudentAssignment.findFirst.mockResolvedValue({ id: 'qsa-1', quizId: 'quiz-1' });
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.seatingAssignment.findFirst.mockResolvedValue({ seatId: 'seat-1', seat: { roomId: 'room-1' } });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue(null);

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it('403s when the actor has no faculty account at all', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.quizStudentAssignment.findFirst.mockResolvedValue({ id: 'qsa-1', quizId: 'quiz-1' });
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.seatingAssignment.findFirst.mockResolvedValue({ seatId: 'seat-1', seat: { roomId: 'room-1' } });
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it('creates the attendance row and audits it when everything checks out', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.quizStudentAssignment.findFirst.mockResolvedValue({ id: 'qsa-1', quizId: 'quiz-1' });
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.seatingAssignment.findFirst.mockResolvedValue({ seatId: 'seat-1', seat: { roomId: 'room-1' } });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue({ facultyId: 'fac-1' });
      const created = { id: 'att-1', quizStudentAssignmentId: 'qsa-1', seatId: 'seat-1', status: dto.status };
      prisma.__tx.attendance.create.mockResolvedValue(created);

      const result = await service.mark('s1', dto, facultyActor);

      expect(result).toEqual(created);
      expect(prisma.__tx.attendance.create).toHaveBeenCalledWith({
        data: {
          quizStudentAssignmentId: 'qsa-1',
          seatId: 'seat-1',
          status: dto.status,
          method: dto.method,
          markedByFacultyId: 'fac-1',
        },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Attendance', entityId: 'att-1' }),
        expect.anything(),
      );
    });

    it('maps a concurrent unique-constraint race (P2002) to a clean 409', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.quizStudentAssignment.findFirst.mockResolvedValue({ id: 'qsa-1', quizId: 'quiz-1' });
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.seatingAssignment.findFirst.mockResolvedValue({ seatId: 'seat-1', seat: { roomId: 'room-1' } });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue({ facultyId: 'fac-1' });
      prisma.__tx.attendance.create.mockRejectedValue(p2002());

      await expect(service.mark('s1', dto, facultyActor)).rejects.toThrow(ConflictException);
    });
  });

  describe('update — BR-035 (post-lock reason required, 423), history logging', () => {
    const existingRow = {
      id: 'att-1',
      status: AttendanceStatus.ABSENT,
      locked: false,
      markedByFacultyId: 'fac-1',
      seat: { roomId: 'room-1' },
      quizStudentAssignment: { examSessionId: 's1' },
    };

    it('404s when the attendance row does not exist', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { status: AttendanceStatus.PRESENT }, admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403s a non-invigilator-of-record faculty', async () => {
      prisma.attendance.findUnique.mockResolvedValue(existingRow);
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-2' });
      prisma.examInvigilator.findFirst.mockResolvedValue(null);

      await expect(
        service.update('att-1', { status: AttendanceStatus.PRESENT }, otherFacultyActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN bypasses the invigilator-of-record check entirely (no ForbiddenException, no examInvigilator lookup)', async () => {
      prisma.attendance.findUnique.mockResolvedValue(existingRow);
      prisma.__tx.attendance.update.mockResolvedValue({ ...existingRow, status: AttendanceStatus.PRESENT });

      await service.update('att-1', { status: AttendanceStatus.PRESENT }, admin);

      expect(prisma.examInvigilator.findFirst).not.toHaveBeenCalled();
    });

    it('423s changing a LOCKED row without a reason (BR-035)', async () => {
      prisma.attendance.findUnique.mockResolvedValue({ ...existingRow, locked: true });

      await expect(service.update('att-1', { status: AttendanceStatus.PRESENT }, admin)).rejects.toThrow(
        HttpException,
      );
      try {
        await service.update('att-1', { status: AttendanceStatus.PRESENT }, admin);
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(423);
      }
    });

    it('allows changing a LOCKED row WITH a reason, recording history', async () => {
      prisma.attendance.findUnique.mockResolvedValue({ ...existingRow, locked: true });
      prisma.__tx.attendance.update.mockResolvedValue({
        ...existingRow,
        locked: true,
        status: AttendanceStatus.PRESENT,
      });

      const result = await service.update(
        'att-1',
        { status: AttendanceStatus.PRESENT, reason: 'Student was actually present, corrected after review' },
        admin,
      );

      expect(result.status).toBe(AttendanceStatus.PRESENT);
      expect(prisma.__tx.attendanceHistory.create).toHaveBeenCalledWith({
        data: {
          attendanceId: 'att-1',
          changedByFacultyId: 'fac-1',
          oldStatus: AttendanceStatus.ABSENT,
          newStatus: AttendanceStatus.PRESENT,
          reason: 'Student was actually present, corrected after review',
        },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'Attendance' }),
        expect.anything(),
      );
    });

    it('a no-op PATCH (same status) is a no-op — no history row, no locked-reason requirement', async () => {
      prisma.attendance.findUnique.mockResolvedValue({ ...existingRow, locked: true });

      const result = await service.update('att-1', { status: AttendanceStatus.ABSENT }, admin);

      expect(result).toEqual({ ...existingRow, locked: true });
      expect(prisma.__tx.attendanceHistory.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('records history for a PRE-lock change too, without requiring a reason (BR-035 gate is locked-only)', async () => {
      prisma.attendance.findUnique.mockResolvedValue(existingRow);
      prisma.__tx.attendance.update.mockResolvedValue({ ...existingRow, status: AttendanceStatus.PRESENT });

      await service.update('att-1', { status: AttendanceStatus.PRESENT }, admin);

      expect(prisma.__tx.attendanceHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ reason: null }) }),
      );
    });
  });

  describe('listForSession — ADMIN sees all, FACULTY sees own room only', () => {
    it('ADMIN gets an unfiltered query', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      prisma.attendance.findMany.mockResolvedValue([]);

      await service.listForSession('s1', admin, {});

      expect(prisma.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { quizStudentAssignment: { examSessionId: 's1' } } }),
      );
    });

    it('FACULTY gets filtered to rooms they invigilate in this session', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findMany.mockResolvedValue([{ roomId: 'room-1' }, { roomId: 'room-2' }]);
      prisma.attendance.findMany.mockResolvedValue([]);

      await service.listForSession('s1', facultyActor, {});

      expect(prisma.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quizStudentAssignment: { examSessionId: 's1' }, seat: { roomId: { in: ['room-1', 'room-2'] } } },
        }),
      );
    });

    it('a faculty invigilating no room in this session gets an empty page, not an error', async () => {
      examSessionsService.findById.mockResolvedValue(inProgressSession);
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findMany.mockResolvedValue([]);
      prisma.attendance.findMany.mockResolvedValue([]);

      const result = await service.listForSession('s1', facultyActor, {});

      expect(result.items).toEqual([]);
    });
  });

  describe('getHistoryForStudent — self/ADMIN, 404-not-403', () => {
    it('404s when the student does not exist', async () => {
      studentsService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.getHistoryForStudent('missing', admin, {})).rejects.toThrow(NotFoundException);
    });

    it('ADMIN can view any student\'s history', async () => {
      studentsService.findById.mockResolvedValue({ id: 'stu-1', userId: 'user-stu-1' });
      prisma.attendance.findMany.mockResolvedValue([]);

      const result = await service.getHistoryForStudent('stu-1', admin, {});

      expect(result.items).toEqual([]);
    });

    it('a student can view their OWN history', async () => {
      studentsService.findById.mockResolvedValue({ id: 'stu-1', userId: 'user-stu-1' });
      prisma.attendance.findMany.mockResolvedValue([{ id: 'att-1' }]);

      const selfActor: AuthenticatedUser = { id: 'user-stu-1', email: 's@example.com', roles: [ROLE.STUDENT] };
      const result = await service.getHistoryForStudent('stu-1', selfActor, {});

      expect(result.items).toHaveLength(1);
    });

    it('404s (not 403) when a student requests a DIFFERENT student\'s history', async () => {
      studentsService.findById.mockResolvedValue({ id: 'stu-1', userId: 'user-stu-1' });

      const otherStudent: AuthenticatedUser = { id: 'user-stu-2', email: 's2@example.com', roles: [ROLE.STUDENT] };
      await expect(service.getHistoryForStudent('stu-1', otherStudent, {})).rejects.toThrow(NotFoundException);
    });
  });
});
