import { QuizStatus } from '@exam-sync/db';
import { RoomSuggestionService } from './room-suggestion.service';
import { RoomHoldsService } from '../../common/room-holds/room-holds.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const faculty: AuthenticatedUser = { id: 'u1', email: 'f@example.com', roles: [ROLE.FACULTY], mustChangePassword: false };

const rooms = [
  { id: 'r1', building: 'B', floor: 0, roomNumber: '101' },
  { id: 'r2', building: 'B', floor: 0, roomNumber: '102' },
  { id: 'r3', building: 'B', floor: 1, roomNumber: '201' },
  { id: 'r4', building: 'C', floor: 0, roomNumber: '101' },
  { id: 'r5', building: 'D', floor: 0, roomNumber: '101' },
];
/** B has three 25-seat rooms (4 columns... see below), C and D have one 40-seat room each. */
const seatsFor = (roomId: string, count: number, cols: number) =>
  Array.from({ length: count }, (_, i) => ({ roomId, colIndex: i % cols }));

describe('RoomSuggestionService — building/floor rule, retired Sequential, empty-column sizing', () => {
  let prisma: any;
  let conflictEngine: any;
  let roomsService: any;
  let quizzesService: any;
  let service: RoomSuggestionService;

  const quiz = {
    id: 'q1',
    status: QuizStatus.DRAFT,
    studentCount: 70,
    preferredDate: new Date('2027-03-01'),
    preferredTime: new Date('1970-01-01T09:00:00Z'),
    durationMinutes: 60,
  };

  beforeEach(() => {
    const seats = [
      ...seatsFor('r1', 25, 5), ...seatsFor('r2', 25, 5), ...seatsFor('r3', 25, 5),
      ...seatsFor('r4', 40, 8), ...seatsFor('r5', 40, 8),
    ];
    prisma = {
      roomHold: { findMany: jest.fn().mockResolvedValue([]) },
      examSessionQuiz: { findMany: jest.fn().mockResolvedValue([]) },
      roomSeat: {
        groupBy: jest.fn().mockImplementation(({ where }: any) => {
          const ids: string[] = where.roomId.in;
          return Promise.resolve(ids.map((roomId) => ({ roomId, _count: { id: seats.filter((s) => s.roomId === roomId).length } })));
        }),
        findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(seats.filter((s) => where.roomId.in.includes(s.roomId)))),
      },
    };
    conflictEngine = { checkRoomAllocation: jest.fn().mockResolvedValue({ hard: [], warnings: [] }) };
    roomsService = { findAvailable: jest.fn().mockResolvedValue(rooms) };
    quizzesService = { findById: jest.fn().mockResolvedValue(quiz) };
    service = new RoomSuggestionService(
      prisma,
      {} as any,
      {} as any,
      conflictEngine,
      roomsService,
      quizzesService,
      { isOwnerOrCoInstructor: jest.fn().mockResolvedValue(true) } as any,
      new RoomHoldsService(prisma, { queue: jest.fn() } as any),
    );
  });

  it('offers only Fewest Classes and Balanced Spread — Sequential is retired', async () => {
    const result = await service.suggestForQuiz('q1', faculty);
    expect(result.strategies.map((s) => s.strategy)).toEqual(['FEWEST_ROOMS', 'BALANCED_SPREAD']);
  });

  it('stays in one building, floor by floor, and offers fewest-rooms as an alternative when that needs fewer rooms', async () => {
    const result = await service.suggestForQuiz('q1', faculty); // 70 students: only building B alone fits (75 seats)
    const fewest = result.strategies[0];

    expect(fewest.rooms.map((r) => `${r.building}-${r.roomNumber}`)).toEqual(['B-101', 'B-102', 'B-201']);
    expect(fewest.location).toBe('Building B · floors 0–1');
    expect(fewest.spansBuildings).toBe(false);
    expect(fewest.alternative).toMatchObject({ label: 'Fewest rooms overall', roomCount: 2, spansBuildings: true });
    expect(fewest.alternative?.rooms.map((r) => `${r.building}-${r.roomNumber}`)).toEqual(['C-101', 'D-101']);
  });

  it('asks nothing extra (no alternative) when staying together already uses the fewest rooms', async () => {
    quizzesService.findById.mockResolvedValue({ ...quiz, studentCount: 30 });
    const result = await service.suggestForQuiz('q1', faculty);
    expect(result.strategies.every((s) => s.alternative === undefined)).toBe(true);
  });

  it('counts only the usable seats when empty columns are planned', async () => {
    const full = await service.suggestForQuiz('q1', faculty, false);
    const spaced = await service.suggestForQuiz('q1', faculty, true);

    expect(full.emptyColumns).toBe(false);
    expect(spaced.emptyColumns).toBe(true);
    const capacityOf = (r: typeof full, id: string) => r.allRooms.find((x) => x.roomId === id)?.capacity;
    expect(capacityOf(full, 'r1')).toBe(25);
    expect(capacityOf(spaced, 'r1')).toBe(15); // columns 0,2,4 of 5 -> 3 of 5 columns kept
    expect(capacityOf(spaced, 'r4')).toBe(20); // 4 of 8 columns kept
  });

  it('reports a shortfall when even every room is not enough', async () => {
    quizzesService.findById.mockResolvedValue({ ...quiz, studentCount: 500 });
    expect((await service.suggestForQuiz('q1', faculty)).shortfall).toBe(true);
  });

  it('does not suggest seats other quizzes already hold (and ignores this quiz\'s own holds)', async () => {
    prisma.roomHold.findMany.mockResolvedValue([
      { roomId: 'r1', quizId: 'qc', seatsHeld: 20, quiz: { title: 'Quiz C' } },
      { roomId: 'r2', quizId: 'qc', seatsHeld: 25, quiz: { title: 'Quiz C' } },
    ]); // r2 fully held by others
    const result = await service.suggestForQuiz('q1', faculty);

    const capacityOf = (id: string) => result.allRooms.find((x) => x.roomId === id)?.capacity;
    expect(capacityOf('r1')).toBe(5); // 25 seats - 20 held
    expect(capacityOf('r2')).toBeUndefined(); // nothing left, so not offered at all
    const whereArg = prisma.roomHold.findMany.mock.calls[0][0].where.AND[1];
    expect(whereArg.quizId).toEqual({ notIn: ['q1'] }); // the quiz's own holds do not count against it
  });

  it('says which other quiz a suggested room is shared with, in every list it appears in', async () => {
    prisma.roomHold.findMany.mockResolvedValue([{ roomId: 'r1', quizId: 'qc', seatsHeld: 20, quiz: { title: 'Quiz C' } }]);
    const result = await service.suggestForQuiz('q1', faculty);

    const shared = [{ quizId: 'qc', quizTitle: 'Quiz C', seats: 20 }];
    expect(result.allRooms.find((r) => r.roomId === 'r1')?.sharedWith).toEqual(shared);
    const suggested = result.strategies.flatMap((s) => s.rooms).find((r) => r.roomId === 'r1');
    expect(suggested?.sharedWith).toEqual(shared);
    expect(result.allRooms.find((r) => r.roomId === 'r3')?.sharedWith).toBeUndefined();
  });
});
