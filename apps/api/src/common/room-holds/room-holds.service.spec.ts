import { ConflictException } from '@nestjs/common';
import { RoomHoldsService, apportion, quizWindow, sameWindow, QuizForHold } from './room-holds.service';

const DATE = new Date('2027-03-01T00:00:00Z');
const NINE = new Date('1970-01-01T09:00:00Z');

const quiz = (over: Partial<QuizForHold> = {}): QuizForHold => ({
  id: 'q1',
  title: 'DBMS',
  studentCount: 30,
  preferredDate: DATE,
  preferredTime: NINE,
  durationMinutes: 60,
  requestedRoomIds: ['r1', 'r2'],
  backupRoomId: null,
  backupRoomLocked: false,
  emptyColumnsPlanned: null,
  ...over,
});

function build() {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    room: { findMany: jest.fn().mockResolvedValue([
      { id: 'r1', building: 'B', roomNumber: '101', status: 'ACTIVE', availabilityBlocks: [] },
      { id: 'r2', building: 'B', roomNumber: '102', status: 'ACTIVE', availabilityBlocks: [] },
      { id: 'r3', building: 'B', roomNumber: '201', status: 'ACTIVE', availabilityBlocks: [] },
    ]) },
    examSessionRoom: { findMany: jest.fn().mockResolvedValue([]) },
    roomSeat: {
      groupBy: jest.fn().mockResolvedValue([
        { roomId: 'r1', _count: { id: 20 } },
        { roomId: 'r2', _count: { id: 20 } },
        { roomId: 'r3', _count: { id: 30 } },
      ]),
      findMany: jest.fn(),
    },
    roomHold: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `h-${data.roomId}`, ...data })),
      updateMany: jest.fn(),
    },
    quiz: { findMany: jest.fn().mockResolvedValue([{ id: 'q1', title: 'DBMS', createdByFacultyId: 'fac-1' }]) },
    faculty: { findMany: jest.fn().mockResolvedValue([{ id: 'fac-1', userId: 'user-fac-1' }]) },
  };
  const outbox = { queue: jest.fn() };
  return { tx, outbox, service: new RoomHoldsService(tx, outbox as any) };
}

describe('quizWindow / sameWindow', () => {
  it('lasts the quiz duration (default 2 hours) and is capped at the end of the day', () => {
    expect(quizWindow(quiz())!.end.toISOString().slice(11, 16)).toBe('10:00');
    expect(quizWindow(quiz({ durationMinutes: null }))!.end.toISOString().slice(11, 16)).toBe('11:00');
    expect(quizWindow(quiz({ preferredTime: new Date('1970-01-01T23:30:00Z'), durationMinutes: 120 }))!.end.toISOString().slice(11, 19)).toBe('23:59:59');
  });

  it('is null without a date or time, and compares windows exactly', () => {
    expect(quizWindow(quiz({ preferredDate: null }))).toBeNull();
    const w = quizWindow(quiz())!;
    expect(sameWindow(w, { ...w })).toBe(true);
    expect(sameWindow(w, { ...w, date: new Date('2027-03-02T00:00:00Z') })).toBe(false);
  });
});

describe('apportion', () => {
  it('splits proportionally with largest remainders and never exceeds a weight', () => {
    expect(apportion(30, [20, 20])).toEqual([15, 15]);
    expect(apportion(31, [20, 20])).toEqual([16, 15]);
    expect(apportion(40, [20, 20])).toEqual([20, 20]);
    expect(apportion(10, [0, 0])).toEqual([0, 0]);
  });
});

describe('RoomHoldsService.placeForApprovedQuiz', () => {
  it('holds the quiz\'s students across its rooms in proportion to free seats, under a row lock', async () => {
    const { tx, service } = build();

    const holds = await service.placeForApprovedQuiz(tx, quiz());

    expect(tx.$queryRaw).toHaveBeenCalled(); // SELECT ... FOR UPDATE on the rooms
    expect(holds.map((h) => [h.roomId, h.kind, h.seatsHeld])).toEqual([['r1', 'MAIN', 15], ['r2', 'MAIN', 15]]);
    expect(tx.roomHold.create.mock.calls[0][0].data).toMatchObject({ quizId: 'q1', holdDate: DATE, startTime: NINE });
  });

  it('does nothing for a quiz without requested rooms, a head count, or a slot', async () => {
    const { tx, service } = build();
    expect(await service.placeForApprovedQuiz(tx, quiz({ requestedRoomIds: [] }))).toEqual([]);
    expect(await service.placeForApprovedQuiz(tx, quiz({ studentCount: null }))).toEqual([]);
    expect(await service.placeForApprovedQuiz(tx, quiz({ preferredTime: null }))).toEqual([]);
    expect(tx.roomHold.create).not.toHaveBeenCalled();
  });

  it('counts only usable seats when empty columns were planned', async () => {
    const { tx, service } = build();
    tx.roomSeat.findMany.mockResolvedValue([
      ...Array.from({ length: 20 }, (_, i) => ({ roomId: 'r1', colIndex: i % 4 })), // 4 columns -> columns 0 and 2 kept -> 10
      ...Array.from({ length: 20 }, (_, i) => ({ roomId: 'r2', colIndex: i % 4 })),
    ]);

    await expect(service.placeForApprovedQuiz(tx, quiz({ studentCount: 30, emptyColumnsPlanned: true }))).rejects.toThrow(/Only 20 free seats/);
  });

  it('refuses (409) when other quizzes already hold the seats, saying how many are free', async () => {
    const { tx, service } = build();
    tx.roomHold.findMany.mockResolvedValue([{ roomId: 'r1', seatsHeld: 15 }, { roomId: 'r2', seatsHeld: 15 }]); // only 5 + 5 free

    await expect(service.placeForApprovedQuiz(tx, quiz())).rejects.toThrow(/Only 10 free seats/);
    expect(tx.roomHold.create).not.toHaveBeenCalled();
  });

  it('lets several quizzes share a room as long as the seats fit (the other quiz holds 10 of 20)', async () => {
    const { tx, service } = build();
    tx.roomHold.findMany.mockResolvedValue([{ roomId: 'r1', seatsHeld: 10 }]);

    const holds = await service.placeForApprovedQuiz(tx, quiz({ studentCount: 20 }));

    expect(holds.map((h) => [h.roomId, h.seatsHeld])).toEqual([['r1', 7], ['r2', 13]]); // r1 has 10 free, r2 has 20
  });

  it('refuses a room that is inactive, blocked, or already allocated to another session', async () => {
    const { tx, service } = build();
    tx.room.findMany.mockResolvedValue([
      { id: 'r1', building: 'B', roomNumber: '101', status: 'MAINTENANCE', availabilityBlocks: [] },
      { id: 'r2', building: 'B', roomNumber: '102', status: 'ACTIVE', availabilityBlocks: [{ id: 'blk' }] },
    ]);
    await expect(service.placeForApprovedQuiz(tx, quiz())).rejects.toBeInstanceOf(ConflictException);

    tx.room.findMany.mockResolvedValue([
      { id: 'r1', building: 'B', roomNumber: '101', status: 'ACTIVE', availabilityBlocks: [] },
      { id: 'r2', building: 'B', roomNumber: '102', status: 'ACTIVE', availabilityBlocks: [] },
    ]);
    tx.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'r1' }]);
    await expect(service.placeForApprovedQuiz(tx, quiz())).rejects.toThrow(/Some of the requested rooms cannot be held/);
  });

  it('also holds the backup room when it is locked — enough seats to replace the biggest main room', async () => {
    const { tx, service } = build();

    const holds = await service.placeForApprovedQuiz(tx, quiz({ backupRoomId: 'r3', backupRoomLocked: true }));

    expect(holds.map((h) => [h.roomId, h.kind, h.seatsHeld])).toEqual([['r1', 'MAIN', 15], ['r2', 'MAIN', 15], ['r3', 'BACKUP', 15]]);
  });

  it('does not hold the backup when it is not locked', async () => {
    const { tx, service } = build();
    const holds = await service.placeForApprovedQuiz(tx, quiz({ backupRoomId: 'r3', backupRoomLocked: false }));
    expect(holds.some((h) => h.kind === 'BACKUP')).toBe(false);
  });

  it('refuses when the locked backup cannot stand in for a main room', async () => {
    const { tx, service } = build();
    tx.roomHold.findMany.mockResolvedValue([{ roomId: 'r3', seatsHeld: 25 }]); // backup has 5 free, needs 15

    await expect(service.placeForApprovedQuiz(tx, quiz({ backupRoomId: 'r3', backupRoomLocked: true }))).rejects.toThrow(/backup room has only 5 free seats/);
  });

  it('releases the quiz\'s earlier holds first, so approving again replaces them', async () => {
    const { tx, service } = build();
    tx.roomHold.findMany.mockImplementation(({ where }: any) => (where.status === 'ACTIVE' ? Promise.resolve([{ id: 'old', quizId: 'q1', roomId: 'r1', seatsHeld: 99, holdDate: DATE, startTime: NINE }]) : Promise.resolve([])));

    await service.placeForApprovedQuiz(tx, quiz());

    expect(tx.roomHold.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RELEASED', releaseReason: 'REPLACED' }) }));
  });
});

describe('RoomHoldsService.releaseForQuizzes / consumeForQuizzes', () => {
  const active = [{ id: 'h1', quizId: 'q1', roomId: 'r1', holdDate: DATE, startTime: NINE }];

  it('marks ACTIVE holds RELEASED with the reason, and tells the quiz\'s faculty when asked', async () => {
    const { tx, outbox, service } = build();
    tx.roomHold.findMany.mockResolvedValue(active);

    const released = await service.releaseForQuizzes(tx, ['q1'], 'TIME_CHANGED', { notify: true });

    expect(released).toEqual(['q1']);
    expect(tx.roomHold.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['h1'] } },
      data: expect.objectContaining({ status: 'RELEASED', releaseReason: 'TIME_CHANGED' }),
    });
    expect(outbox.queue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        recipientId: 'user-fac-1',
        eventType: 'ROOM_HOLD_RELEASED',
        payload: expect.objectContaining({ quiz_title: 'DBMS', hold_date: '2027-03-01', start_time: '09:00', reason: 'TIME_CHANGED' }),
      }),
    );
  });

  it('stays silent when notify is off, and does nothing when there are no active holds', async () => {
    const { tx, outbox, service } = build();
    tx.roomHold.findMany.mockResolvedValue(active);
    await service.releaseForQuizzes(tx, ['q1'], 'SESSION_CANCELLED', { notify: false });
    expect(outbox.queue).not.toHaveBeenCalled();

    tx.roomHold.findMany.mockResolvedValue([]);
    tx.roomHold.updateMany.mockClear();
    expect(await service.releaseForQuizzes(tx, ['q1'], 'X', { notify: true })).toEqual([]);
    expect(tx.roomHold.updateMany).not.toHaveBeenCalled();
  });

  it('turns ACTIVE holds into CONSUMED when the rooms are allocated', async () => {
    const { tx, service } = build();
    await service.consumeForQuizzes(tx, ['q1', 'q2']);
    expect(tx.roomHold.updateMany).toHaveBeenCalledWith({
      where: { quizId: { in: ['q1', 'q2'] }, status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'CONSUMED' }),
    });
  });
});

describe('RoomHoldsService.heldSeatsByRoom', () => {
  it('sums held seats per room for an overlapping window, excluding the given quizzes, and only holds still running', async () => {
    const { tx, service } = build();
    tx.roomHold.findMany.mockResolvedValue([{ roomId: 'r1', seatsHeld: 10 }, { roomId: 'r1', seatsHeld: 5 }, { roomId: 'r2', seatsHeld: 7 }]);

    const held = await service.heldSeatsByRoom(tx, ['r1', 'r2', 'r3'], { date: DATE, start: NINE, end: new Date('1970-01-01T10:00:00Z') }, ['q-own']);

    expect(held.get('r1')).toBe(15);
    expect(held.get('r2')).toBe(7);
    expect(held.get('r3')).toBe(0);
    const where = tx.roomHold.findMany.mock.calls[0][0].where.AND;
    expect(where[0]).toMatchObject({ status: 'ACTIVE' }); // lapsed windows are ignored
    expect(where[1]).toMatchObject({ roomId: { in: ['r1', 'r2', 'r3'] }, holdDate: DATE, quizId: { notIn: ['q-own'] } });
    expect(where[1].startTime).toEqual({ lt: new Date('1970-01-01T10:00:00Z') }); // overlap test: starts before the window ends...
    expect(where[1].endTime).toEqual({ gt: NINE }); // ...and ends after it starts
  });
});

describe('sharedHoldsByRoom / runningHoldsOnDay — who else is in the room', () => {
  it('lists one entry per other quiz in each room, adding up a quiz\'s seats, and leaves the excluded quizzes out', async () => {
    const { tx, service } = build();
    tx.roomHold.findMany.mockResolvedValue([
      { roomId: 'r1', quizId: 'qc', seatsHeld: 2, quiz: { title: 'Quiz C' } },
      { roomId: 'r1', quizId: 'qc', seatsHeld: 1, quiz: { title: 'Quiz C' } },
      { roomId: 'r1', quizId: 'qd', seatsHeld: 4, quiz: { title: 'Quiz D' } },
      { roomId: 'r2', quizId: 'qc', seatsHeld: 5, quiz: { title: 'Quiz C' } },
    ]);

    const shared = await service.sharedHoldsByRoom(tx, ['r1', 'r2', 'r3'], quizWindow(quiz())!, ['q1']);

    expect(shared.get('r1')).toEqual([
      { quizId: 'qc', quizTitle: 'Quiz C', seats: 3 },
      { quizId: 'qd', quizTitle: 'Quiz D', seats: 4 },
    ]);
    expect(shared.get('r2')).toEqual([{ quizId: 'qc', quizTitle: 'Quiz C', seats: 5 }]);
    expect(shared.has('r3')).toBe(false);
    expect(tx.roomHold.findMany.mock.calls[0][0].where.AND[1].quizId).toEqual({ notIn: ['q1'] });
  });

  it('timeline: merges holds with the same window in a room into one block with the total seats and all quiz titles', async () => {
    const { tx, service } = build();
    const start = new Date('1970-01-01T09:30:00Z');
    const end = new Date('1970-01-01T11:00:00Z');
    tx.roomHold.findMany.mockResolvedValue([
      { roomId: 'r1', startTime: start, endTime: end, seatsHeld: 2, quiz: { title: 'Quiz C' } },
      { roomId: 'r1', startTime: start, endTime: end, seatsHeld: 3, quiz: { title: 'Quiz D' } },
      { roomId: 'r1', startTime: new Date('1970-01-01T14:00:00Z'), endTime: new Date('1970-01-01T15:00:00Z'), seatsHeld: 1, quiz: { title: 'Quiz E' } },
    ]);

    const blocks = await service.runningHoldsOnDay(tx, ['r1'], DATE);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ roomId: 'r1', seats: 5, quizTitles: ['Quiz C', 'Quiz D'] });
    expect(blocks[1]).toMatchObject({ seats: 1, quizTitles: ['Quiz E'] });
  });
});
