import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { IncidentAction, IncidentSeverity, IncidentStatus, IncidentType } from '@exam-sync/db';
import { IncidentsService } from './incidents.service';
import { ExamSessionsService } from '../exam-session';
import { FacultyService } from '../faculty';
import { StudentsService } from '../students';
import { RoomsService } from '../rooms';
import { QuizzesService } from '../quiz';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { NotificationsOutboxService } from '../../common/notifications-outbox/notifications-outbox.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    incident: { create: jest.fn(), update: jest.fn() },
    incidentHistory: { create: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return {
    incident: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    incidentHistory: { findMany: jest.fn() },
    roomSeat: { findUnique: jest.fn() },
    examInvigilator: { findFirst: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: [ROLE.ADMIN], mustChangePassword: false };
const facultyActor: AuthenticatedUser = { id: 'user-fac-1', email: 'f@example.com', roles: [ROLE.FACULTY], mustChangePassword: false };

const baseIncident = {
  id: 'inc-1',
  examSessionId: 's1',
  quizId: null,
  studentId: null,
  roomId: null,
  seatId: null,
  reportedByFacultyId: 'fac-1',
  incidentType: IncidentType.MISCONDUCT,
  severity: IncidentSeverity.LOW,
  description: 'test',
  status: IncidentStatus.OPEN,
  resolution: null,
  disclosedAt: null,
};

describe('IncidentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let notificationsOutbox: { queue: jest.Mock };
  let examSessionsService: { findById: jest.Mock };
  let facultyService: { findByUserId: jest.Mock };
  let studentsService: { findById: jest.Mock };
  let roomsService: { findById: jest.Mock };
  let quizzesService: { findById: jest.Mock };
  let service: IncidentsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    notificationsOutbox = { queue: jest.fn() };
    examSessionsService = { findById: jest.fn() };
    facultyService = { findByUserId: jest.fn() };
    studentsService = { findById: jest.fn() };
    roomsService = { findById: jest.fn() };
    quizzesService = { findById: jest.fn() };

    service = new IncidentsService(
      prisma,
      auditHook as unknown as AuditHookService,
      notificationsOutbox as unknown as NotificationsOutboxService,
      examSessionsService as unknown as ExamSessionsService,
      facultyService as unknown as FacultyService,
      studentsService as unknown as StudentsService,
      roomsService as unknown as RoomsService,
      quizzesService as unknown as QuizzesService,
    );
  });

  describe('create — BR-037 (invigilator-of-record), FR-039, EC-029 (not session-status-gated)', () => {
    const dto = {
      exam_session_id: 's1',
      incident_type: IncidentType.MISCONDUCT,
      severity: IncidentSeverity.LOW,
      description: 'Student talking during exam',
    };

    it('does NOT gate on exam session status (EC-029) — only existence', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'COMPLETED' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue({ facultyId: 'fac-1' });
      prisma.__tx.incident.create.mockResolvedValue({ ...baseIncident });

      await expect(service.create(dto, facultyActor)).resolves.toBeDefined();
    });

    it('403s when the actor has no faculty account', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue(null);

      await expect(service.create(dto, facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it('403s when the faculty is not an invigilator anywhere in this session', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue(null);

      await expect(service.create(dto, facultyActor)).rejects.toThrow(ForbiddenException);
    });

    it('403s when room_id is given but the faculty invigilates a DIFFERENT room in this session', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      roomsService.findById.mockResolvedValue({ id: 'room-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue(null); // scoped query (session+room+faculty) finds nothing

      await expect(service.create({ ...dto, room_id: 'room-1' }, facultyActor)).rejects.toThrow(ForbiddenException);
      expect(prisma.examInvigilator.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { examSessionId: 's1', facultyId: 'fac-1', roomId: 'room-1' } }),
      );
    });

    it('derives the room from seat_id for the invigilator check when room_id is omitted', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.roomSeat.findUnique.mockResolvedValue({ id: 'seat-1', roomId: 'room-9' });
      prisma.examInvigilator.findFirst.mockResolvedValue({ facultyId: 'fac-1' });
      prisma.__tx.incident.create.mockResolvedValue({ ...baseIncident, seatId: 'seat-1' });

      await service.create({ ...dto, seat_id: 'seat-1' }, facultyActor);

      expect(prisma.examInvigilator.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { examSessionId: 's1', facultyId: 'fac-1', roomId: 'room-9' } }),
      );
    });

    it('422s when seat_id does not belong to the given room_id', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      roomsService.findById.mockResolvedValue({ id: 'room-1' });
      prisma.roomSeat.findUnique.mockResolvedValue({ id: 'seat-1', roomId: 'room-OTHER' });

      await expect(
        service.create({ ...dto, room_id: 'room-1', seat_id: 'seat-1' }, facultyActor),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('404s when seat_id does not exist', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.roomSeat.findUnique.mockResolvedValue(null);

      await expect(service.create({ ...dto, seat_id: 'seat-missing' }, facultyActor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates the incident, writes a CREATE history row, and audits it', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue({ facultyId: 'fac-1' });
      const created = { ...baseIncident, id: 'inc-1' };
      prisma.__tx.incident.create.mockResolvedValue(created);

      const result = await service.create(dto, facultyActor);

      expect(result).toEqual(created);
      expect(prisma.__tx.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            examSessionId: 's1',
            reportedByFacultyId: 'fac-1',
            incidentType: dto.incident_type,
            severity: dto.severity,
            description: dto.description,
          }),
        }),
      );
      expect(prisma.__tx.incidentHistory.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'inc-1',
          actorId: facultyActor.id,
          action: IncidentAction.CREATE,
          oldStatus: null,
          newStatus: IncidentStatus.OPEN,
          notes: null,
        },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Incident', entityId: 'inc-1' }),
        expect.anything(),
      );
    });

    it('queues an immediate Admin notification for CRITICAL severity (BR-038)', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue({ facultyId: 'fac-1' });
      prisma.__tx.incident.create.mockResolvedValue({ ...baseIncident, severity: IncidentSeverity.CRITICAL });
      prisma.__tx.user.findMany.mockResolvedValue([{ id: 'admin-user-1' }, { id: 'admin-user-2' }]);

      await service.create({ ...dto, severity: IncidentSeverity.CRITICAL }, facultyActor);

      expect(notificationsOutbox.queue).toHaveBeenCalledTimes(2);
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ recipientId: 'admin-user-1', eventType: 'INCIDENT_STATUS_UPDATED' }),
      );
    });

    it('does NOT queue a notification for non-CRITICAL severity', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.examInvigilator.findFirst.mockResolvedValue({ facultyId: 'fac-1' });
      prisma.__tx.incident.create.mockResolvedValue({ ...baseIncident, severity: IncidentSeverity.LOW });

      await service.create(dto, facultyActor);

      expect(notificationsOutbox.queue).not.toHaveBeenCalled();
    });

    it('validates optional FK targets exist (quiz/student/room)', async () => {
      examSessionsService.findById.mockResolvedValue({ id: 's1', status: 'IN_PROGRESS' });
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      quizzesService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.create({ ...dto, quiz_id: 'quiz-missing' }, facultyActor)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus — the exact ARCHITECTURE.md §AD-2 #6 state graph, BR-039', () => {
    it('404s when the incident does not exist', async () => {
      prisma.incident.findUnique.mockResolvedValue(null);
      await expect(service.updateStatus('missing', { action: IncidentAction.INVESTIGATE }, admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([
      [IncidentStatus.OPEN, IncidentAction.RESOLVE],
      [IncidentStatus.OPEN, IncidentAction.DISMISS],
      [IncidentStatus.OPEN, IncidentAction.ESCALATE],
      [IncidentStatus.RESOLVED, IncidentAction.INVESTIGATE],
      [IncidentStatus.RESOLVED, IncidentAction.ESCALATE],
      [IncidentStatus.DISMISSED, IncidentAction.INVESTIGATE],
      [IncidentStatus.ESCALATED, IncidentAction.RESOLVE], // must go through UNDER_REVIEW first
      [IncidentStatus.ESCALATED, IncidentAction.DISMISS],
    ])('409s an invalid transition: %s -> (%s)', async (fromStatus, action) => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: fromStatus });

      await expect(
        service.updateStatus('inc-1', { action, resolution: 'x' }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('OPEN -> UNDER_REVIEW via INVESTIGATE', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: IncidentStatus.OPEN });
      prisma.__tx.incident.update.mockResolvedValue({ ...baseIncident, status: IncidentStatus.UNDER_REVIEW });

      const result = await service.updateStatus('inc-1', { action: IncidentAction.INVESTIGATE }, admin);

      expect(result.status).toBe(IncidentStatus.UNDER_REVIEW);
      expect(prisma.__tx.incidentHistory.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'inc-1',
          actorId: admin.id,
          action: IncidentAction.INVESTIGATE,
          oldStatus: IncidentStatus.OPEN,
          newStatus: IncidentStatus.UNDER_REVIEW,
          notes: null,
        },
      });
    });

    it('ESCALATED -> UNDER_REVIEW via INVESTIGATE (re-review)', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: IncidentStatus.ESCALATED });
      prisma.__tx.incident.update.mockResolvedValue({ ...baseIncident, status: IncidentStatus.UNDER_REVIEW });

      const result = await service.updateStatus('inc-1', { action: IncidentAction.INVESTIGATE }, admin);

      expect(result.status).toBe(IncidentStatus.UNDER_REVIEW);
    });

    it('UNDER_REVIEW -> ESCALATED via ESCALATE, and notifies all Admins immediately', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: IncidentStatus.UNDER_REVIEW });
      prisma.__tx.incident.update.mockResolvedValue({ ...baseIncident, status: IncidentStatus.ESCALATED });
      prisma.__tx.user.findMany.mockResolvedValue([{ id: 'admin-user-1' }]);

      const result = await service.updateStatus('inc-1', { action: IncidentAction.ESCALATE }, admin);

      expect(result.status).toBe(IncidentStatus.ESCALATED);
      expect(notificationsOutbox.queue).toHaveBeenCalledWith(
        prisma.__tx,
        expect.objectContaining({ recipientId: 'admin-user-1', eventType: 'INCIDENT_STATUS_UPDATED' }),
      );
    });

    it('422s RESOLVE without a resolution', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: IncidentStatus.UNDER_REVIEW });

      await expect(service.updateStatus('inc-1', { action: IncidentAction.RESOLVE }, admin)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('422s DISMISS without a resolution', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: IncidentStatus.UNDER_REVIEW });

      await expect(service.updateStatus('inc-1', { action: IncidentAction.DISMISS }, admin)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('UNDER_REVIEW -> RESOLVED via RESOLVE with a resolution, stamping resolvedByAdminId/resolvedAt', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: IncidentStatus.UNDER_REVIEW });
      prisma.__tx.incident.update.mockResolvedValue({
        ...baseIncident,
        status: IncidentStatus.RESOLVED,
        resolution: 'Verified false alarm',
      });

      const result = await service.updateStatus(
        'inc-1',
        { action: IncidentAction.RESOLVE, resolution: 'Verified false alarm' },
        admin,
      );

      expect(result.status).toBe(IncidentStatus.RESOLVED);
      expect(prisma.__tx.incident.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: {
          status: IncidentStatus.RESOLVED,
          resolution: 'Verified false alarm',
          resolvedByAdminId: admin.id,
          resolvedAt: expect.any(Date),
        },
      });
    });

    it('UNDER_REVIEW -> DISMISSED via DISMISS with a resolution', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, status: IncidentStatus.UNDER_REVIEW });
      prisma.__tx.incident.update.mockResolvedValue({ ...baseIncident, status: IncidentStatus.DISMISSED });

      const result = await service.updateStatus(
        'inc-1',
        { action: IncidentAction.DISMISS, resolution: 'Reported wrong student, filing correction' },
        admin,
      );

      expect(result.status).toBe(IncidentStatus.DISMISSED);
    });
  });

  describe('list — ADMIN sees all, FACULTY sees own reported only', () => {
    it('ADMIN gets an unfiltered-by-reporter query', async () => {
      prisma.incident.findMany.mockResolvedValue([]);

      await service.list(admin, {});

      const call = prisma.incident.findMany.mock.calls[0][0];
      expect(call.where.reportedByFacultyId).toBeUndefined();
    });

    it('FACULTY is filtered to their own reportedByFacultyId', async () => {
      facultyService.findByUserId.mockResolvedValue({ id: 'fac-1' });
      prisma.incident.findMany.mockResolvedValue([]);

      await service.list(facultyActor, {});

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ reportedByFacultyId: 'fac-1' }) }),
      );
    });

    it('passes through status/severity/examSessionId filters', async () => {
      prisma.incident.findMany.mockResolvedValue([]);

      await service.list(admin, { status: IncidentStatus.OPEN, severity: IncidentSeverity.HIGH, examSessionId: 's1' });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: IncidentStatus.OPEN, severity: IncidentSeverity.HIGH, examSessionId: 's1' }),
        }),
      );
    });

    it('resolves human-readable labels instead of leaving raw FK UUIDs for the UI to render', async () => {
      prisma.incident.findMany.mockResolvedValue([
        {
          id: 'inc-1',
          examSessionId: 'session-1',
          roomId: 'room-1',
          studentId: 'student-1',
          quizId: 'quiz-1',
          examSession: { name: 'Mid-Sem Slot A' },
          room: { building: 'B', roomNumber: '209' },
          student: { name: 'Test Student', rollNumber: '100001' },
          quiz: { title: 'DBMS Quiz' },
        },
      ]);

      const result = await service.list(admin, {});

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          examSessionName: 'Mid-Sem Slot A',
          roomLabel: 'B · Room 209',
          studentLabel: 'Test Student (100001)',
          quizTitle: 'DBMS Quiz',
        }),
      );
      // The joined relation objects themselves must not leak onto the row —
      // only the resolved label fields should be added.
      expect(result.items[0]).not.toHaveProperty('examSession');
      expect(result.items[0]).not.toHaveProperty('room');
      expect(result.items[0]).not.toHaveProperty('student');
      expect(result.items[0]).not.toHaveProperty('quiz');
    });

    it('resolves null labels for optional FKs that are absent (roomId/studentId/quizId all null)', async () => {
      prisma.incident.findMany.mockResolvedValue([
        {
          id: 'inc-1',
          examSessionId: 'session-1',
          roomId: null,
          studentId: null,
          quizId: null,
          examSession: { name: 'Mid-Sem Slot A' },
          room: null,
          student: null,
          quiz: null,
        },
      ]);

      const result = await service.list(admin, {});

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          examSessionName: 'Mid-Sem Slot A',
          roomLabel: null,
          studentLabel: null,
          quizTitle: null,
        }),
      );
    });
  });

  describe('getHistory', () => {
    it('404s when the incident does not exist', async () => {
      prisma.incident.findUnique.mockResolvedValue(null);
      await expect(service.getHistory('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns history rows ordered oldest-first', async () => {
      prisma.incident.findUnique.mockResolvedValue(baseIncident);
      prisma.incidentHistory.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);

      const result = await service.getHistory('inc-1');

      expect(result).toHaveLength(2);
      expect(prisma.incidentHistory.findMany).toHaveBeenCalledWith({
        where: { incidentId: 'inc-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('disclose — ADR-007/DEC-009 (ships inert, no notification, idempotent)', () => {
    it('404s when the incident does not exist', async () => {
      prisma.incident.findUnique.mockResolvedValue(null);
      await expect(service.disclose('missing', admin)).rejects.toThrow(NotFoundException);
    });

    it('sets disclosedAt/disclosedByAdminId and audits it, without any notification', async () => {
      prisma.incident.findUnique.mockResolvedValue({ ...baseIncident, disclosedAt: null });
      prisma.__tx.incident.update.mockResolvedValue({ ...baseIncident, disclosedAt: new Date(), disclosedByAdminId: admin.id });

      const result = await service.disclose('inc-1', admin);

      expect(result.disclosedAt).toBeTruthy();
      expect(prisma.__tx.incident.update).toHaveBeenCalledWith({
        where: { id: 'inc-1' },
        data: { disclosedAt: expect.any(Date), disclosedByAdminId: admin.id },
      });
      expect(notificationsOutbox.queue).not.toHaveBeenCalled();
      expect(auditHook.record).toHaveBeenCalled();
    });

    it('is idempotent — re-disclosing an already-disclosed incident is a no-op', async () => {
      const alreadyDisclosed = { ...baseIncident, disclosedAt: new Date('2026-01-01'), disclosedByAdminId: 'admin-x' };
      prisma.incident.findUnique.mockResolvedValue(alreadyDisclosed);

      const result = await service.disclose('inc-1', admin);

      expect(result).toEqual(alreadyDisclosed);
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });
  });
});
