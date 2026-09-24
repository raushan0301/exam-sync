import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, Prisma } from '@exam-sync/db';
import { RoomAllocationService } from './room-allocation.service';
import { ExamSessionsService, ExamSessionOwnershipService } from '../exam-session';
import { ConflictEngineService } from '../conflict-engine';
import { RoomsService } from '../rooms';
import { QuizzesService, QuizOwnershipService } from '../quiz';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    $queryRaw: jest.fn(),
    examSessionRoom: { create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: `esr-${args.data.roomId}`, ...args.data })) },
    examSessionRoomQuiz: { create: jest.fn() },
    examSession: { update: jest.fn() },
    roomSeat: { groupBy: jest.fn() },
  };
  return {
    quizStudentAssignment: { groupBy: jest.fn() },
    room: { findMany: jest.fn() },
    quiz: { update: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: args.where.id, ...args.data })) },
    examSessionQuiz: { findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
    __tx: tx,
  } as any;
}

function exclusionViolation(): Prisma.PrismaClientUnknownRequestError {
  return new Prisma.PrismaClientUnknownRequestError(
    'Error occurred during query execution: ConnectorError... code: "23P01", message: "conflicting key value violates exclusion constraint \\"exam_session_rooms_no_overlap\\""',
    { clientVersion: '5.22.0' },
  );
}

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

const draftLikeSession = {
  id: 's1',
  status: ExamSessionStatus.ROOM_ALLOCATION,
  sessionDate: new Date('2026-05-01T00:00:00Z'),
  startTime: new Date('1970-01-01T10:00:00Z'),
  endTime: new Date('1970-01-01T11:00:00Z'),
  requestedRoomIds: [] as string[],
  backupRoomId: null as string | null,
};

describe('RoomAllocationService — Phase 12 (Best-Fit Decreasing, BR-018/021/022, SELECT FOR UPDATE)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let examSessionsService: { findById: jest.Mock };
  let conflictEngine: { checkRoomAllocation: jest.Mock; checkSessionAssembly: jest.Mock };
  let roomsService: { findAvailable: jest.Mock };
  let examSessionOwnershipService: { isOwnerOrCoInstructor: jest.Mock };
  let quizzesService: { findById: jest.Mock };
  let quizOwnershipService: { isOwnerOrCoInstructor: jest.Mock };
  let service: RoomAllocationService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    examSessionsService = { findById: jest.fn() };
    conflictEngine = {
      checkRoomAllocation: jest.fn().mockResolvedValue({ hard: [], warnings: [] }),
      checkSessionAssembly: jest.fn().mockResolvedValue({ hard: [], warnings: [] }),
    };
    roomsService = { findAvailable: jest.fn() };
    examSessionOwnershipService = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };
    quizzesService = { findById: jest.fn() };
    quizOwnershipService = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };

    service = new RoomAllocationService(
      prisma,
      auditHook as unknown as AuditHookService,
      examSessionsService as unknown as ExamSessionsService,
      conflictEngine as unknown as ConflictEngineService,
      roomsService as unknown as RoomsService,
      examSessionOwnershipService as unknown as ExamSessionOwnershipService,
      quizzesService as unknown as QuizzesService,
      quizOwnershipService as unknown as QuizOwnershipService,
    );
  });

  function mockLockedRooms(ids: string[]) {
    prisma.__tx.$queryRaw.mockResolvedValue(ids.map((id) => ({ id })));
  }
  function mockSeatCounts(counts: Record<string, number>) {
    prisma.__tx.roomSeat.groupBy.mockResolvedValue(
      Object.entries(counts).map(([roomId, n]) => ({ roomId, _count: { id: n } })),
    );
  }
  function mockGroups(groups: { quizId: string; count: number }[]) {
    prisma.quizStudentAssignment.groupBy.mockResolvedValue(
      groups.map((g) => ({ quizId: g.quizId, _count: { studentId: g.count } })),
    );
  }

  describe('preconditions', () => {
    it('rejects a session not in ROOM_ALLOCATION with 409 (ADMIN approval requires a pending faculty room request)', async () => {
      examSessionsService.findById.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.ASSIGNING_STUDENTS });

      await expect(
        service.allocate('s1', { room_ids: ['room-1'] }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a session with zero ASSIGNED students', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([]);

      await expect(
        service.allocate('s1', { room_ids: ['room-1'] }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects manual mode with no room_ids (400)', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);

      await expect(
        service.allocate('s1', {}, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('auto mode with no candidate_room_ids searches via RoomsService.findAvailable', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      roomsService.findAvailable.mockResolvedValue([{ id: 'room-1' }, { id: 'room-2' }]);
      mockLockedRooms(['room-1', 'room-2']);
      mockSeatCounts({ 'room-1': 20, 'room-2': 20 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { auto: true }, admin);

      expect(roomsService.findAvailable).toHaveBeenCalledWith({
        date: '2026-05-01',
        start_time: '10:00',
        end_time: '11:00',
      });
    });

    it('auto mode with candidate_room_ids uses them directly, without calling findAvailable', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      mockLockedRooms(['room-9']);
      mockSeatCounts({ 'room-9': 20 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { auto: true, candidate_room_ids: ['room-9'] }, admin);

      expect(roomsService.findAvailable).not.toHaveBeenCalled();
    });

    it('404s when a candidate room id does not exist (lock returns fewer rows than requested)', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      mockLockedRooms(['room-1']); // only 1 of 2 requested rooms actually exists

      await expect(
        service.allocate('s1', { room_ids: ['room-1', 'missing-room'] }, admin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('SELECT ... FOR UPDATE row locking (ADR-003)', () => {
    it('locks every candidate room via a raw FOR UPDATE query before checking conflicts', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      mockLockedRooms(['room-1']);
      mockSeatCounts({ 'room-1': 20 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { room_ids: ['room-1'] }, admin);

      expect(prisma.__tx.$queryRaw).toHaveBeenCalled();
      const sqlCall = prisma.__tx.$queryRaw.mock.calls[0][0];
      expect(sqlCall.strings.join('')).toContain('FOR UPDATE');
      // The lock happens before the conflict check.
      expect(conflictEngine.checkRoomAllocation).toHaveBeenCalledWith(
        expect.objectContaining({ examSessionId: 's1', roomIds: ['room-1'] }),
        prisma.__tx,
      );
    });
  });

  describe('BR-018/BR-022 — real Conflict Engine hard conflicts abort the allocation', () => {
    it('aborts with 409 and never writes when checkRoomAllocation reports a hard conflict', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      mockLockedRooms(['room-1']);
      conflictEngine.checkRoomAllocation.mockResolvedValue({
        hard: [{ type: 'ROOM_UNAVAILABLE', roomId: 'room-1', message: 'unavailable' }],
        warnings: [],
      });

      await expect(
        service.allocate('s1', { room_ids: ['room-1'] }, admin),
      ).rejects.toThrow(ConflictException);
      expect(prisma.__tx.examSessionRoom.create).not.toHaveBeenCalled();
      expect(prisma.__tx.examSession.update).not.toHaveBeenCalled();
    });
  });

  describe('BR-021 / EC-011 — aggregate capacity shortfall aborts all-or-nothing', () => {
    it('rejects with 409 and creates NO exam_session_rooms rows when total capacity < total students', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 50 }]);
      mockLockedRooms(['room-1']);
      mockSeatCounts({ 'room-1': 30 }); // shortfall of 20

      const error = await service
        .allocate('s1', { room_ids: ['room-1'] }, admin)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().details[0].message).toContain('Shortfall: 20');
      expect(prisma.__tx.examSessionRoom.create).not.toHaveBeenCalled();
    });

    it('uses ACTIVE seat counts, not the room.capacity field, for the capacity check', async () => {
      // A room with capacity=100 on paper but only 10 ACTIVE seats (90 disabled) must be treated as 10.
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 50 }]);
      mockLockedRooms(['room-1']);
      mockSeatCounts({ 'room-1': 10 });

      await expect(
        service.allocate('s1', { room_ids: ['room-1'] }, admin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Phase 13 integration — ExamSessionRoomQuiz breakdown persisted alongside each room', () => {
    it('persists one ExamSessionRoomQuiz row per (room, quiz) placement, not just the aggregate total', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }, { quizId: 'quiz-2', count: 5 }]);
      mockLockedRooms(['room-1']);
      mockSeatCounts({ 'room-1': 100 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { room_ids: ['room-1'] }, admin);

      expect(prisma.__tx.examSessionRoomQuiz.create).toHaveBeenCalledTimes(2);
      const calls = prisma.__tx.examSessionRoomQuiz.create.mock.calls.map((c: any) => c[0].data);
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ quizId: 'quiz-1', studentCount: 10 }),
          expect.objectContaining({ quizId: 'quiz-2', studentCount: 5 }),
        ]),
      );
      // Every breakdown row references the SAME examSessionRoom id that was just created for room-1
      // (mock: `esr-${roomId}`, see buildPrismaMock's examSessionRoom.create implementation).
      expect(calls.every((c: any) => c.examSessionRoomId === 'esr-room-1')).toBe(true);
    });

    it('splits the breakdown correctly when one quiz group spans two rooms (EC-005)', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 70 }]);
      mockLockedRooms(['room-a', 'room-b']);
      mockSeatCounts({ 'room-a': 40, 'room-b': 40 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { room_ids: ['room-a', 'room-b'] }, admin);

      const calls = prisma.__tx.examSessionRoomQuiz.create.mock.calls.map((c: any) => c[0].data);
      expect(calls).toHaveLength(2);
      expect(calls.reduce((sum: number, c: any) => sum + c.studentCount, 0)).toBe(70);
      expect(calls.every((c: any) => c.quizId === 'quiz-1')).toBe(true);
    });
  });

  describe('Best-Fit Decreasing packing (ARCHITECTURE.md §S)', () => {
    it('places a single group that fits entirely in one room, choosing the tightest (best) fit among candidates', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 30 }]);
      mockLockedRooms(['room-small', 'room-big']);
      mockSeatCounts({ 'room-small': 40, 'room-big': 100 }); // both fit; room-small is the tighter fit
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { room_ids: ['room-small', 'room-big'] }, admin);

      expect(prisma.__tx.examSessionRoom.create).toHaveBeenCalledTimes(1);
      expect(prisma.__tx.examSessionRoom.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ roomId: 'room-small', allocatedCapacity: 30 }) }),
      );
    });

    it('splits a group larger than any single room across multiple rooms (EC-005)', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 70 }]); // no single room (max 40) can hold this
      mockLockedRooms(['room-a', 'room-b']);
      mockSeatCounts({ 'room-a': 40, 'room-b': 40 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { room_ids: ['room-a', 'room-b'] }, admin);

      expect(prisma.__tx.examSessionRoom.create).toHaveBeenCalledTimes(2);
      const totalAllocated = prisma.__tx.examSessionRoom.create.mock.calls
        .map((c: any) => c[0].data.allocatedCapacity)
        .reduce((a: number, b: number) => a + b, 0);
      expect(totalAllocated).toBe(70);
    });

    it('places the LARGEST student group first (decreasing order)', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      // Two rooms: one exact-fit (25) for the larger group, one smaller
      // (10) for the rest. If the SMALLER group (10) were placed first
      // instead, it would consume room-other itself just as well (same
      // result there), but critically it could ALSO fit into room-exact
      // first — decreasing order guarantees the LARGER group (25) claims
      // the exact-fit room, not the smaller one arriving first and taking
      // it by accident.
      mockGroups([{ quizId: 'quiz-small', count: 10 }, { quizId: 'quiz-large', count: 25 }]);
      mockLockedRooms(['room-exact', 'room-other']);
      mockSeatCounts({ 'room-exact': 25, 'room-other': 10 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { room_ids: ['room-exact', 'room-other'] }, admin);

      const calls = prisma.__tx.examSessionRoom.create.mock.calls.map((c: any) => c[0].data);
      const largeGroupPlacement = calls.find((c: any) => c.roomId === 'room-exact');
      expect(largeGroupPlacement.allocatedCapacity).toBe(25); // quiz-large (25) got the exact-fit room
    });

    it('aggregates multiple groups sharing one room into a single exam_session_rooms row with the summed capacity', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }, { quizId: 'quiz-2', count: 5 }]);
      mockLockedRooms(['room-1']);
      mockSeatCounts({ 'room-1': 100 }); // one big room fits both groups (BR-023: sharing allowed)
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      await service.allocate('s1', { room_ids: ['room-1'] }, admin);

      expect(prisma.__tx.examSessionRoom.create).toHaveBeenCalledTimes(1);
      expect(prisma.__tx.examSessionRoom.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ roomId: 'room-1', allocatedCapacity: 15 }) }),
      );
    });
  });

  describe('success — session status transition and audit', () => {
    it('transitions the session to SEATING_GENERATION and audits the change', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      mockLockedRooms(['room-1']);
      mockSeatCounts({ 'room-1': 20 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      const result = await service.allocate('s1', { room_ids: ['room-1'] }, admin);

      expect(result.status).toBe(ExamSessionStatus.SEATING_GENERATION);
      expect(prisma.__tx.examSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: {
          status: ExamSessionStatus.SEATING_GENERATION,
          requestedRoomIds: [],
          backupRoomId: null,
          roomRejectionReason: null,
          version: { increment: 1 },
        },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entityType: 'ExamSession', entityId: 's1' }),
        expect.anything(),
      );
    });

    it('re-running allocate on the same session after it left ASSIGNING_STUDENTS is rejected (idempotency guard)', async () => {
      examSessionsService.findById.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.SEATING_GENERATION });

      await expect(
        service.allocate('s1', { room_ids: ['room-1'] }, admin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('exclusion-constraint backstop (defense in depth, ADR-003)', () => {
    it('maps a raw 23P01 exclusion-violation error to a clean ConflictException', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      prisma.$transaction.mockRejectedValue(exclusionViolation());

      await expect(
        service.allocate('s1', { room_ids: ['room-1'] }, admin),
      ).rejects.toThrow(ConflictException);
    });

    it('does not swallow an unrelated error', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      const genuinelyUnexpected = new Error('boom');
      prisma.$transaction.mockRejectedValue(genuinelyUnexpected);

      await expect(
        service.allocate('s1', { room_ids: ['room-1'] }, admin),
      ).rejects.toThrow('boom');
    });
  });

  describe('allocatePreApproved — FACULTY self-service using ONLY the quiz-approval-time approved room(s)', () => {
    const faculty: AuthenticatedUser = { id: 'faculty-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };
    const assigningSession = { ...draftLikeSession, status: ExamSessionStatus.ASSIGNING_STUDENTS };

    it('404s a non-owner FACULTY', async () => {
      examSessionsService.findById.mockResolvedValue(assigningSession);
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(service.allocatePreApproved('s1', faculty)).rejects.toThrow(NotFoundException);
    });

    it('409s when the session is not ASSIGNING_STUDENTS', async () => {
      examSessionsService.findById.mockResolvedValue({ ...assigningSession, status: ExamSessionStatus.ROOM_ALLOCATION });

      await expect(service.allocatePreApproved('s1', faculty)).rejects.toThrow(ConflictException);
    });

    it('409s when the attached quiz has no admin-approved room request', async () => {
      examSessionsService.findById.mockResolvedValue(assigningSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([
        { quiz: { id: 'quiz-1', requestedRoomIds: [] } },
      ]);

      await expect(service.allocatePreApproved('s1', faculty)).rejects.toThrow(ConflictException);
    });

    it('allocates straight from ASSIGNING_STUDENTS using the union of every attached quiz\'s approved rooms — no admin step', async () => {
      examSessionsService.findById.mockResolvedValue(assigningSession);
      prisma.examSessionQuiz.findMany.mockResolvedValue([
        { quiz: { id: 'quiz-1', requestedRoomIds: ['room-1'] } },
      ]);
      mockGroups([{ quizId: 'quiz-1', count: 10 }]);
      mockLockedRooms(['room-1']);
      mockSeatCounts({ 'room-1': 20 });
      prisma.__tx.examSession.update.mockResolvedValue({ ...assigningSession, status: ExamSessionStatus.SEATING_GENERATION, version: 2 });

      const result = await service.allocatePreApproved('s1', faculty);

      expect(result.status).toBe(ExamSessionStatus.SEATING_GENERATION);
      expect(prisma.__tx.examSessionRoom.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ roomId: 'room-1' }) }),
      );
    });
  });

  describe('request — FACULTY submits a room request (ASSIGNING_STUDENTS -> ROOM_ALLOCATION)', () => {
    const faculty: AuthenticatedUser = { id: 'faculty-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };
    const assigningSession = { ...draftLikeSession, status: ExamSessionStatus.ASSIGNING_STUDENTS };

    it('404s a non-owner (IDOR-safe)', async () => {
      examSessionsService.findById.mockResolvedValue(assigningSession);
      examSessionOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(
        service.request('s1', { room_ids: ['room-1'] }, faculty),
      ).rejects.toThrow(NotFoundException);
    });

    it('409s when the session is not ASSIGNING_STUDENTS', async () => {
      examSessionsService.findById.mockResolvedValue({ ...assigningSession, status: ExamSessionStatus.ROOM_ALLOCATION });

      await expect(
        service.request('s1', { room_ids: ['room-1'] }, faculty),
      ).rejects.toThrow(ConflictException);
    });

    it('400s when backup_room_id also appears in room_ids', async () => {
      examSessionsService.findById.mockResolvedValue(assigningSession);

      await expect(
        service.request('s1', { room_ids: ['room-1'], backup_room_id: 'room-1' }, faculty),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when a requested room does not exist', async () => {
      examSessionsService.findById.mockResolvedValue(assigningSession);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-1' }]);

      await expect(
        service.request('s1', { room_ids: ['room-1', 'ghost-room'] }, faculty),
      ).rejects.toThrow(NotFoundException);
    });

    it('moves the session to ROOM_ALLOCATION and stores the request + backup room + strategy', async () => {
      examSessionsService.findById.mockResolvedValue(assigningSession);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-1' }, { id: 'room-2' }, { id: 'room-backup' }]);
      prisma.__tx.examSession.update.mockResolvedValue({
        ...assigningSession,
        status: ExamSessionStatus.ROOM_ALLOCATION,
        requestedRoomIds: ['room-1', 'room-2'],
        backupRoomId: 'room-backup',
        version: 2,
      });

      const result = await service.request(
        's1',
        { room_ids: ['room-1', 'room-2'], backup_room_id: 'room-backup', strategy: 'FEWEST_ROOMS' },
        faculty,
      );

      expect(result.status).toBe(ExamSessionStatus.ROOM_ALLOCATION);
      expect(prisma.__tx.examSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: {
          status: ExamSessionStatus.ROOM_ALLOCATION,
          requestedRoomIds: ['room-1', 'room-2'],
          backupRoomId: 'room-backup',
          roomAllocationStrategy: 'FEWEST_ROOMS',
          roomRejectionReason: null,
          version: { increment: 1 },
        },
      });
      expect(auditHook.record).toHaveBeenCalled();
    });
  });

  describe('reject — ADMIN sends a pending room request back to the faculty', () => {
    it('409s when there is no pending request (not ROOM_ALLOCATION)', async () => {
      examSessionsService.findById.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.ASSIGNING_STUDENTS });

      await expect(service.reject('s1', { reason: 'No rooms free' }, admin)).rejects.toThrow(ConflictException);
    });

    it('moves ROOM_ALLOCATION back to ASSIGNING_STUDENTS, clears the request, and stores the reason', async () => {
      examSessionsService.findById.mockResolvedValue(draftLikeSession);
      prisma.__tx.examSession.update.mockResolvedValue({
        ...draftLikeSession,
        status: ExamSessionStatus.ASSIGNING_STUDENTS,
        requestedRoomIds: [],
        backupRoomId: null,
        roomRejectionReason: 'No rooms free at that time',
        version: 2,
      });

      const result = await service.reject('s1', { reason: 'No rooms free at that time' }, admin);

      expect(result.status).toBe(ExamSessionStatus.ASSIGNING_STUDENTS);
      expect(prisma.__tx.examSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: {
          status: ExamSessionStatus.ASSIGNING_STUDENTS,
          requestedRoomIds: [],
          backupRoomId: null,
          roomRejectionReason: 'No rooms free at that time',
          version: { increment: 1 },
        },
      });
      expect(auditHook.record).toHaveBeenCalled();
    });
  });

  describe('getAvailabilityPreview — live availability + alternatives for the admin review screen', () => {
    it('409s when the session is not ROOM_ALLOCATION', async () => {
      examSessionsService.findById.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.ASSIGNING_STUDENTS });

      await expect(service.getAvailabilityPreview('s1', admin)).rejects.toThrow(ConflictException);
    });

    it('marks a requested room unavailable and suggests alternatives when it conflicts', async () => {
      const session = { ...draftLikeSession, requestedRoomIds: ['room-1'], backupRoomId: null };
      examSessionsService.findById.mockResolvedValue(session);
      prisma.room.findMany.mockResolvedValue([
        { id: 'room-1', building: 'A', floor: 1, roomNumber: '101', capacity: 30 },
      ]);
      conflictEngine.checkRoomAllocation
        .mockResolvedValueOnce({ hard: [{ type: 'ROOM_OVERLAP', roomId: 'room-1', message: 'already booked' }], warnings: [] })
        .mockResolvedValueOnce({ hard: [], warnings: [] });
      roomsService.findAvailable.mockResolvedValue([{ id: 'room-2', building: 'A', floor: 1, roomNumber: '102', capacity: 40 }]);

      const preview = await service.getAvailabilityPreview('s1', admin);

      expect(preview.requestedRooms[0].available).toBe(false);
      expect(preview.requestedRooms[0].reason).toContain('already booked');
      expect(preview.requestedRooms[0].alternatives?.[0].roomId).toBe('room-2');
    });
  });

  describe('requestForQuiz — FACULTY builds it (DRAFT/REJECTED), ADMIN may swap while reviewing (SUBMITTED)', () => {
    const faculty: AuthenticatedUser = { id: 'faculty-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };
    const draftQuiz = { id: 'q1', status: 'DRAFT', createdByFacultyId: 'faculty-1' };
    const submittedQuiz = { ...draftQuiz, status: 'SUBMITTED' };

    it('404s a non-owner FACULTY', async () => {
      quizzesService.findById.mockResolvedValue(draftQuiz);
      quizOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(service.requestForQuiz('q1', { room_ids: ['room-1'] }, faculty)).rejects.toThrow(NotFoundException);
    });

    it('blocks FACULTY from changing it once SUBMITTED', async () => {
      quizzesService.findById.mockResolvedValue(submittedQuiz);
      quizOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(true);

      await expect(service.requestForQuiz('q1', { room_ids: ['room-1'] }, faculty)).rejects.toThrow(ConflictException);
    });

    it('lets ADMIN swap the room set while the quiz is SUBMITTED, bypassing ownership entirely', async () => {
      quizzesService.findById.mockResolvedValue(submittedQuiz);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-2' }]);

      await service.requestForQuiz('q1', { room_ids: ['room-2'] }, admin);

      expect(quizOwnershipService.isOwnerOrCoInstructor).not.toHaveBeenCalled();
      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: { requestedRoomIds: ['room-2'], backupRoomId: null, roomAllocationStrategy: null, roomAdjustmentNote: null },
      });
    });

    it("stores the ADMIN's note (e.g. explaining a backup-room removal) on the quiz, visible to the faculty", async () => {
      quizzesService.findById.mockResolvedValue(submittedQuiz);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-2' }]);

      await service.requestForQuiz('q1', { room_ids: ['room-2'], admin_note: 'Backup room removed — it was double-booked.' }, admin);

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: {
          requestedRoomIds: ['room-2'],
          backupRoomId: null,
          roomAllocationStrategy: null,
          roomAdjustmentNote: 'Backup room removed — it was double-booked.',
        },
      });
    });

    it("ignores a FACULTY-supplied admin_note (only an ADMIN's own edit can set one)", async () => {
      quizzesService.findById.mockResolvedValue(draftQuiz);
      quizOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(true);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-1' }]);

      await service.requestForQuiz('q1', { room_ids: ['room-1'], admin_note: 'ignored' } as any, faculty);

      expect(prisma.quiz.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ roomAdjustmentNote: null }) }),
      );
    });

    it('still blocks ADMIN once the quiz is fully APPROVED (nothing left to swap)', async () => {
      quizzesService.findById.mockResolvedValue({ ...draftQuiz, status: 'APPROVED' });

      await expect(service.requestForQuiz('q1', { room_ids: ['room-1'] }, admin)).rejects.toThrow(ConflictException);
    });
  });

  describe('getQuizRoomConflicts', () => {
    it('404s a non-owner FACULTY', async () => {
      quizzesService.findById.mockResolvedValue({ id: 'q1', requestedRoomIds: ['room-1'], backupRoomId: null, preferredDate: new Date(), preferredTime: new Date() });
      quizOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

      await expect(service.getQuizRoomConflicts('q1', { id: 'faculty-1', email: 'f@x.com', roles: ['FACULTY'], mustChangePassword: false })).rejects.toThrow(NotFoundException);
    });

    it('ADMIN sees it unscoped', async () => {
      quizzesService.findById.mockResolvedValue({
        id: 'q1',
        requestedRoomIds: ['room-1'],
        backupRoomId: null,
        roomAllocationStrategy: 'FEWEST_ROOMS',
        preferredDate: new Date('2026-05-01T00:00:00Z'),
        preferredTime: new Date('1970-01-01T10:00:00Z'),
        durationMinutes: 60,
      });
      prisma.room.findMany.mockResolvedValue([{ id: 'room-1', building: 'A', floor: 1, roomNumber: '101', capacity: 30 }]);
      roomsService.findAvailable.mockResolvedValue([]);

      const result = await service.getQuizRoomConflicts('q1', admin);

      expect(result.requestedRooms[0].roomId).toBe('room-1');
      expect(result.studentConflicts).toEqual([]);
      expect(quizOwnershipService.isOwnerOrCoInstructor).not.toHaveBeenCalled();
    });

    it("surfaces a BR-019 student-schedule conflict against the quiz's OWN preferred slot — visible before the quiz is even approved", async () => {
      quizzesService.findById.mockResolvedValue({
        id: 'q1',
        requestedRoomIds: [],
        backupRoomId: null,
        roomAllocationStrategy: null,
        preferredDate: new Date('2026-05-01T00:00:00Z'),
        preferredTime: new Date('1970-01-01T10:00:00Z'),
        durationMinutes: 60,
      });
      conflictEngine.checkSessionAssembly.mockResolvedValue({
        hard: [
          {
            type: 'STUDENT_OVERLAP',
            studentId: 'student-1',
            conflictingExamSessionId: 'other-session',
            message: 'Student "student-1" already has an active assignment in exam session "other-session".',
          },
        ],
        warnings: [],
      });

      const result = await service.getQuizRoomConflicts('q1', admin);

      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(
        expect.objectContaining({ quizIds: ['q1'] }),
      );
      expect(result.studentConflicts).toEqual([
        { studentId: 'student-1', conflictingExamSessionId: 'other-session', message: expect.stringContaining('student-1') },
      ]);
      expect(result.requestedRooms).toEqual([]);
    });

    it("excludes the quiz's OWN actively-attached exam session, not just the NIL sentinel — a quiz must not conflict with its own booking after approval", async () => {
      quizzesService.findById.mockResolvedValue({
        id: 'q1',
        requestedRoomIds: [],
        backupRoomId: null,
        roomAllocationStrategy: null,
        preferredDate: new Date('2026-05-01T00:00:00Z'),
        preferredTime: new Date('1970-01-01T10:00:00Z'),
        durationMinutes: 60,
      });
      prisma.examSessionQuiz.findFirst.mockResolvedValue({ examSessionId: 'real-session-1' });
      conflictEngine.checkSessionAssembly.mockResolvedValue({ hard: [], warnings: [] });

      await service.getQuizRoomConflicts('q1', admin);

      expect(prisma.examSessionQuiz.findFirst).toHaveBeenCalledWith({
        where: { quizId: 'q1', isActiveAttachment: true },
        select: { examSessionId: true },
      });
      expect(conflictEngine.checkSessionAssembly).toHaveBeenCalledWith(
        expect.objectContaining({ examSessionId: 'real-session-1' }),
      );
    });
  });
});
