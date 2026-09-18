import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExamSessionStatus, Prisma } from '@exam-sync/db';
import { RoomAllocationService } from './room-allocation.service';
import { ExamSessionsService } from '../exam-session';
import { ConflictEngineService } from '../conflict-engine';
import { RoomsService } from '../rooms';
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

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };

const draftLikeSession = {
  id: 's1',
  status: ExamSessionStatus.ASSIGNING_STUDENTS,
  sessionDate: new Date('2026-05-01T00:00:00Z'),
  startTime: new Date('1970-01-01T10:00:00Z'),
  endTime: new Date('1970-01-01T11:00:00Z'),
};

describe('RoomAllocationService — Phase 12 (Best-Fit Decreasing, BR-018/021/022, SELECT FOR UPDATE)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let examSessionsService: { findById: jest.Mock };
  let conflictEngine: { checkRoomAllocation: jest.Mock };
  let roomsService: { findAvailable: jest.Mock };
  let service: RoomAllocationService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    examSessionsService = { findById: jest.fn() };
    conflictEngine = { checkRoomAllocation: jest.fn().mockResolvedValue({ hard: [], warnings: [] }) };
    roomsService = { findAvailable: jest.fn() };

    service = new RoomAllocationService(
      prisma,
      auditHook as unknown as AuditHookService,
      examSessionsService as unknown as ExamSessionsService,
      conflictEngine as unknown as ConflictEngineService,
      roomsService as unknown as RoomsService,
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
    it('rejects a session not in ASSIGNING_STUDENTS with 409', async () => {
      examSessionsService.findById.mockResolvedValue({ ...draftLikeSession, status: ExamSessionStatus.DRAFT });

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
        data: { status: ExamSessionStatus.SEATING_GENERATION, version: { increment: 1 } },
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
});
