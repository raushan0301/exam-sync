import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoomExtensionService } from './room-extension.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

const faculty: AuthenticatedUser = { id: 'user-fac-1', email: 'f@example.com', roles: ['FACULTY'], mustChangePassword: false };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'a@example.com', roles: ['ADMIN'], mustChangePassword: false };

const DATE = new Date('2027-03-01T00:00:00Z');
const START = new Date('1970-01-01T09:00:00Z');
const END = new Date('1970-01-01T10:00:00Z');

const session = (over: object = {}) => ({
  id: 's1',
  name: 'Finals',
  status: 'SEATING_GENERATION',
  sessionDate: DATE,
  startTime: START,
  endTime: END,
  emptyColumnsPlanned: null,
  ...over,
});

/** Session with room R1 (finalized, 10 students) and R2 (not finalized); quizzes A and B with 20 students each. */
function build() {
  const db: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    examSessionRoom: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'esr-1', roomId: 'R1', createdAt: new Date('2027-01-01'), allocatedCapacity: 10, room: { building: 'B', floor: 0, roomNumber: '101' } },
        { id: 'esr-2', roomId: 'R2', createdAt: new Date('2027-01-02'), allocatedCapacity: 30, room: { building: 'B', floor: 0, roomNumber: '102' } },
      ]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `esr-${data.roomId}`, ...data })),
      update: jest.fn(),
    },
    seatingPlan: {
      findMany: jest.fn().mockResolvedValue([{ id: 'plan-1', roomId: 'R1' }]), // R1 finalized
      updateMany: jest.fn(),
    },
    seatingAssignment: {
      findMany: jest.fn().mockResolvedValue([
        ...Array.from({ length: 5 }, (_, i) => ({ studentId: `a-${String(i).padStart(2, '0')}`, quizId: 'qa', seatingPlanId: 'plan-1' })),
        ...Array.from({ length: 5 }, (_, i) => ({ studentId: `b-${String(i).padStart(2, '0')}`, quizId: 'qb', seatingPlanId: 'plan-1' })),
      ]),
    },
    examSessionQuiz: { findMany: jest.fn().mockResolvedValue([{ quizId: 'qa' }, { quizId: 'qb' }]) },
    quizStudentAssignment: {
      count: jest.fn().mockResolvedValue(40),
      findMany: jest.fn().mockResolvedValue([
        ...Array.from({ length: 20 }, (_, i) => ({ quizId: 'qa', studentId: `a-${String(i).padStart(2, '0')}` })),
        ...Array.from({ length: 20 }, (_, i) => ({ quizId: 'qb', studentId: `b-${String(i).padStart(2, '0')}` })),
      ]),
    },
    examSessionRoomQuiz: { deleteMany: jest.fn(), create: jest.fn() },
    examSessionRoomStudent: { createMany: jest.fn(), deleteMany: jest.fn() },
    examSession: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Finals', sessionDate: DATE, startTime: START, endTime: END, status: 'ROOM_ALLOCATION' }),
      update: jest.fn().mockResolvedValue({ id: 's1', status: 'SEATING_GENERATION' }),
      updateMany: jest.fn(),
    },
    examSessionRoomRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'req-1', status: 'PENDING', requestedRoomIds: [], approvedRoomIds: [], ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    room: {
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve((where.id.in as string[]).map((id) => ({ id, building: 'B', roomNumber: id === 'R3' ? '201' : id, capacity: 20 }))),
      ),
    },
    faculty: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'user-fac-1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Jaskirat Singh', employeeCode: 'F1' }),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]) },
    $transaction: jest.fn((cb: any) => cb(db)),
  };
  const auditHook = { record: jest.fn() };
  const outbox = { queue: jest.fn() };
  const roomHolds = {
    usableSeatCounts: jest.fn().mockImplementation((_c: unknown, ids: string[], empty: boolean) => Promise.resolve(new Map(ids.map((id) => [id, empty ? 10 : 20])))),
    heldSeatsByRoom: jest.fn().mockResolvedValue(new Map()),
    roomIssues: jest.fn().mockResolvedValue([]),
    lockForRequest: jest.fn().mockResolvedValue(['R3']),
    releaseForRequest: jest.fn(),
    consumeForRequest: jest.fn(),
  };
  const examSessionsService = { findById: jest.fn().mockResolvedValue(session()) };
  const ownershipService = { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) };
  const facultyService = { findByUserId: jest.fn().mockResolvedValue({ id: 'fac-1', name: 'Jaskirat Singh' }) };
  const suggestionService = {
    availablePool: jest.fn().mockResolvedValue([
      { roomId: 'R3', building: 'B', floor: 0, roomNumber: '201', capacity: 20 },
      { roomId: 'R9', building: 'C', floor: 1, roomNumber: '305', capacity: 50 },
    ]),
  };
  const service = new RoomExtensionService(
    db, auditHook as any, outbox as any, roomHolds as any, examSessionsService as any, ownershipService as any, facultyService as any, suggestionService as any,
  );
  return { db, auditHook, outbox, roomHolds, examSessionsService, ownershipService, facultyService, suggestionService, service };
}

describe('RoomExtensionService.state', () => {
  it('reports the shortfall for students outside finalized rooms, the trigger, and the nearest free rooms', async () => {
    const { service } = build();

    const state = await service.state('s1', faculty);

    expect(state).toMatchObject({ canRequest: true, studentsToPlace: 30, fullSeats: 20, usableSeats: 20, seatsNeeded: 10, trigger: 'TOO_MANY_STUDENTS' });
    expect(state.rooms).toEqual([
      { roomId: 'R1', label: 'B-101', allocated: 10, finalized: true },
      { roomId: 'R2', label: 'B-102', allocated: 30, finalized: false },
    ]);
    expect(state.suggestion.rooms.map((r) => r.roomId)).toEqual(['R3']); // same building first
    expect(state.allRooms.map((r) => r.roomId)).toEqual(['R3', 'R9']);
  });

  it('with empty columns the usable seats halve, so the trigger becomes "no room for empty columns"', async () => {
    const { service, db } = build();
    db.quizStudentAssignment.count.mockResolvedValue(25); // 15 outside the finalized room: fits 20 full seats, not 10 usable

    const state = await service.state('s1', faculty, true);

    expect(state).toMatchObject({ emptyColumns: true, studentsToPlace: 15, usableSeats: 10, seatsNeeded: 5, trigger: 'NO_ROOM_FOR_EMPTY_COLUMNS' });
  });

  it('cannot request when every room is finalized, when seating has not started, or when one is already waiting', async () => {
    const a = build();
    a.db.seatingPlan.findMany.mockResolvedValue([{ id: 'p1', roomId: 'R1' }, { id: 'p2', roomId: 'R2' }]);
    expect((await a.service.state('s1', faculty)).blockedReason).toMatch(/already finalized/);

    const b = build();
    b.examSessionsService.findById.mockResolvedValue(session({ status: 'ROOM_ALLOCATION' }));
    expect((await b.service.state('s1', faculty)).blockedReason).toMatch(/only be requested during seating/);

    const c = build();
    c.db.examSessionRoomRequest.findFirst.mockResolvedValue({ id: 'req-9', examSessionId: 's1', requestedByFacultyId: 'fac-1', requestedRoomIds: [], approvedRoomIds: [], status: 'PENDING', emptyColumns: null });
    const pending = await c.service.state('s1', faculty);
    expect(pending.canRequest).toBe(false);
    expect(pending.pending?.id).toBe('req-9');
  });

  it('is invisible (404) to a faculty member who does not own the session', async () => {
    const { service, ownershipService } = build();
    ownershipService.isOwnerOrCoInstructor.mockResolvedValue(false);
    await expect(service.state('s1', faculty)).rejects.toThrow(NotFoundException);
  });
});

describe('RoomExtensionService.create', () => {
  const dto = { room_ids: ['R3'], reason: 'Too many students for the remaining rooms.' };

  it('sends the session back to the Rooms step, locks the free rooms, tells every admin, and remembers the previous status', async () => {
    const { service, db, roomHolds, outbox } = build();

    const request = await service.create('s1', dto, faculty);

    expect(db.examSessionRoomRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ examSessionId: 's1', requestedByFacultyId: 'fac-1', trigger: 'TOO_MANY_STUDENTS', previousStatus: 'SEATING_GENERATION', requestedRoomIds: ['R3'] }),
    });
    expect(roomHolds.lockForRequest).toHaveBeenCalledWith(db, expect.objectContaining({ requestId: 'req-1', quizId: 'qa', roomIds: ['R3'], sessionId: 's1' }));
    expect(db.examSession.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'ROOM_ALLOCATION', version: { increment: 1 } } });
    const sent = outbox.queue.mock.calls.map((c: any[]) => c[1]);
    expect(sent.map((n: any) => n.recipientId)).toEqual(['admin-1', 'admin-2']);
    expect(sent[0]).toMatchObject({ eventType: 'ROOM_REQUEST_SUBMITTED', payload: expect.objectContaining({ faculty_name: 'Jaskirat Singh', session_name: 'Finals', room_count: 1 }) });
    expect(request.id).toBe('req-1');
  });

  it('refuses when not in seating, when one is pending, when everything is finalized, or when a room is already allocated here', async () => {
    const a = build();
    a.examSessionsService.findById.mockResolvedValue(session({ status: 'IN_PROGRESS' }));
    await expect(a.service.create('s1', dto, faculty)).rejects.toThrow(/only be requested during seating/);

    const b = build();
    b.db.examSessionRoomRequest.findFirst.mockResolvedValue({ id: 'req-9' });
    await expect(b.service.create('s1', dto, faculty)).rejects.toThrow(/already waiting/);

    const c = build();
    c.db.seatingPlan.findMany.mockResolvedValue([{ id: 'p1', roomId: 'R1' }, { id: 'p2', roomId: 'R2' }]);
    await expect(c.service.create('s1', dto, faculty)).rejects.toThrow(/already finalized/);

    const d = build();
    await expect(d.service.create('s1', { ...dto, room_ids: ['R2'] }, faculty)).rejects.toThrow(/already allocated to this session/);
  });

  it('only a faculty member who owns the session can ask', async () => {
    const a = build();
    a.facultyService.findByUserId.mockResolvedValue(null);
    await expect(a.service.create('s1', dto, admin)).rejects.toThrow(ForbiddenException);

    const b = build();
    b.ownershipService.isOwnerOrCoInstructor.mockResolvedValue(false);
    await expect(b.service.create('s1', dto, faculty)).rejects.toThrow(NotFoundException);
  });
});

describe('RoomExtensionService.cancel / reject', () => {
  const pending = { id: 'req-1', examSessionId: 's1', requestedByFacultyId: 'fac-1', status: 'PENDING', previousStatus: 'READY_FOR_FINALIZATION', requestedRoomIds: ['R3'], approvedRoomIds: [], emptyColumns: null };

  it('cancel frees the locks and puts the session back exactly as it was', async () => {
    const { service, db, roomHolds } = build();
    db.examSessionRoomRequest.findUnique.mockResolvedValue(pending);
    db.examSessionRoomRequest.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'CANCELLED' });

    const result = await service.cancel('req-1', faculty);

    expect(result.status).toBe('CANCELLED');
    expect(roomHolds.releaseForRequest).toHaveBeenCalledWith(db, 'req-1', 'REQUEST_CANCELLED');
    expect(db.examSession.updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: 'ROOM_ALLOCATION' }, data: { status: 'READY_FOR_FINALIZATION', version: { increment: 1 } } });
  });

  it('reject records the admin and note, frees the locks, restores the status, and tells the faculty why', async () => {
    const { service, db, roomHolds, outbox } = build();
    db.examSessionRoomRequest.findUnique.mockResolvedValue(pending);
    db.examSessionRoomRequest.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'REJECTED' });

    await service.reject('req-1', { note: 'No free room that day.' }, admin);

    expect(db.examSessionRoomRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'REJECTED', reviewedByAdminId: 'admin-1', reviewNote: 'No free room that day.' }),
    });
    expect(roomHolds.releaseForRequest).toHaveBeenCalledWith(db, 'req-1', 'REQUEST_DECLINED');
    expect(db.examSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'READY_FOR_FINALIZATION', version: { increment: 1 } } }));
    expect(outbox.queue).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: 'user-fac-1', eventType: 'ROOM_REQUEST_REJECTED', payload: expect.objectContaining({ note: 'No free room that day.' }) }));
  });

  it('a request that was already decided cannot be decided again', async () => {
    const { service, db } = build();
    db.examSessionRoomRequest.findUnique.mockResolvedValue({ ...pending, status: 'APPROVED' });
    await expect(service.reject('req-1', { note: 'x' }, admin)).rejects.toThrow(/already approved/);
    db.examSessionRoomRequest.findUnique.mockResolvedValue(pending);
    db.examSessionRoomRequest.updateMany.mockResolvedValue({ count: 0 }); // someone else got there first
    await expect(service.cancel('req-1', faculty)).rejects.toThrow(ConflictException);
  });
});

describe('RoomExtensionService.approve — re-split the rooms that are not finalized', () => {
  const pending = { id: 'req-1', examSessionId: 's1', requestedByFacultyId: 'fac-1', status: 'PENDING', previousStatus: 'SEATING_GENERATION', requestedRoomIds: ['R3'], approvedRoomIds: [], emptyColumns: true };

  function ready() {
    const ctx = build();
    ctx.db.examSessionRoomRequest.findUnique.mockResolvedValue(pending);
    ctx.db.examSessionRoomRequest.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'APPROVED' });
    ctx.examSessionsService.findById.mockResolvedValue(session({ status: 'ROOM_ALLOCATION' }));
    return ctx;
  }

  it('adds the room, re-splits the 30 students outside finalized rooms across R2 and R3 with every subject in both, and leaves R1 untouched', async () => {
    const { service, db } = ready();

    await service.approve('req-1', {}, admin);

    // R3 is created, R2 is updated; R1 (finalized) gets neither a new count nor a deleted breakdown.
    expect(db.examSessionRoom.create).toHaveBeenCalledWith({ data: expect.objectContaining({ examSessionId: 's1', roomId: 'R3' }) });
    expect(db.examSessionRoom.update).toHaveBeenCalledTimes(1);
    expect(db.examSessionRoom.update.mock.calls[0][0].where).toEqual({ id: 'esr-2' });
    expect(db.examSessionRoomQuiz.deleteMany).toHaveBeenCalledWith({ where: { examSessionRoomId: { in: ['esr-2'] } } });

    // Who sits where: R1's finalized students are recorded; the other 30 are split, nobody twice, nobody lost.
    const memberRows = db.examSessionRoomStudent.createMany.mock.calls.flatMap((c: any[]) => c[0].data as { examSessionRoomId: string; quizId: string; studentId: string }[]);
    const r1 = memberRows.filter((m: any) => m.examSessionRoomId === 'esr-1');
    const r2 = memberRows.filter((m: any) => m.examSessionRoomId === 'esr-2');
    const r3 = memberRows.filter((m: any) => m.examSessionRoomId === 'esr-R3');
    expect(r1).toHaveLength(10);
    expect(r2.length + r3.length).toBe(30);
    expect(new Set([...r2, ...r3].map((m: any) => m.studentId)).size).toBe(30);
    expect([...r2, ...r3].some((m: any) => r1.some((f: any) => f.studentId === m.studentId))).toBe(false); // no finalized student is moved
    for (const room of [r2, r3]) expect(new Set(room.map((m: any) => m.quizId))).toEqual(new Set(['qa', 'qb'])); // a mix in each room
  });

  it('supersedes the not-finalized rooms\' seating (so they show "not generated yet"), returns the session to seating, consumes the locks, notifies the faculty', async () => {
    const { service, db, roomHolds, outbox } = ready();

    await service.approve('req-1', { note: 'Added B-201.' }, admin);

    expect(db.seatingPlan.updateMany).toHaveBeenCalledWith({
      where: { examSessionId: 's1', roomId: { in: ['R2'] }, status: { notIn: ['SUPERSEDED', 'FINALIZED'] } },
      data: { status: 'SUPERSEDED', version: { increment: 1 } },
    });
    expect(db.examSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'SEATING_GENERATION', emptyColumnsPlanned: true, version: { increment: 1 } },
    });
    expect(roomHolds.consumeForRequest).toHaveBeenCalledWith(db, 'req-1');
    expect(db.examSessionRoomRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'APPROVED', approvedRoomIds: ['R3'], reviewedByAdminId: 'admin-1', reviewNote: 'Added B-201.' }),
    });
    expect(outbox.queue).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: 'user-fac-1', eventType: 'ROOM_REQUEST_APPROVED', payload: expect.objectContaining({ rooms: 'B-201', note: 'Added B-201.' }) }));
  });

  it('lets the admin change the rooms: the locks of a swapped-out room are freed', async () => {
    const { service, roomHolds, db } = ready();

    await service.approve('req-1', { room_ids: ['R9'] }, admin); // R9 instead of the asked-for R3

    expect(roomHolds.releaseForRequest).toHaveBeenCalledWith(db, 'req-1', 'SWAPPED', ['R3']);
    expect(db.examSessionRoom.create).toHaveBeenCalledWith({ data: expect.objectContaining({ roomId: 'R9' }) });
  });

  it('refuses (and changes nothing) when a chosen room is not available, or the seats still do not cover the students', async () => {
    const a = ready();
    a.roomHolds.roomIssues.mockResolvedValue([{ roomId: 'R3', message: 'Room "B · Room 201" is blocked for part of this time.' }]);
    await expect(a.service.approve('req-1', {}, admin)).rejects.toThrow(ConflictException);
    expect(a.db.examSessionRoom.create).not.toHaveBeenCalled();

    const b = ready();
    b.roomHolds.heldSeatsByRoom.mockResolvedValue(new Map([['R2', 15], ['R3', 15]])); // other quizzes hold most of the seats
    await expect(b.service.approve('req-1', {}, admin)).rejects.toThrow(/Still not enough seats/);
    expect(b.db.examSessionRoomQuiz.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses when the session has moved on, or when a chosen room is already in the session', async () => {
    const a = ready();
    a.examSessionsService.findById.mockResolvedValue(session({ status: 'SEATING_GENERATION' }));
    await expect(a.service.approve('req-1', {}, admin)).rejects.toThrow(/can no longer be applied/);

    const b = ready();
    await expect(b.service.approve('req-1', { room_ids: ['R2'] }, admin)).rejects.toThrow(/already allocated to this session/);
  });
});

describe('RoomExtensionService.list', () => {
  it('lets a faculty member see only their own requests', async () => {
    const { service, db } = build();
    db.examSessionRoomRequest.findMany.mockResolvedValue([]);

    await service.list(faculty, {});

    expect(db.examSessionRoomRequest.findMany.mock.calls[0][0].where).toEqual({ requestedByFacultyId: 'fac-1' });
    await service.list(admin, { status: 'PENDING' as any });
    expect(db.examSessionRoomRequest.findMany.mock.calls[1][0].where).toEqual({ status: 'PENDING' });
  });
});
