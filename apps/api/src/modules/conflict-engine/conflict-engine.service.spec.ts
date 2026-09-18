import { ConflictEngineService } from './conflict-engine.service';
import { QuizzesService } from '../quiz';
import { EnrollmentsService } from '../enrollment';
import { ExamSessionStatus, QuizStudentAssignmentStatus, RoomStatus } from '@exam-sync/db';

function buildClientMock() {
  return {
    quizStudentAssignment: { findMany: jest.fn() },
    room: { findMany: jest.fn() },
    examSessionRoom: { findMany: jest.fn() },
    examInvigilator: { findMany: jest.fn() },
  } as any;
}

const SESSION_DATE = new Date('2026-05-01T00:00:00Z');
const START_10 = new Date('1970-01-01T10:00:00Z');
const END_11 = new Date('1970-01-01T11:00:00Z');

describe('ConflictEngineService — Phase 10 (real BR-019 student-overlap detection)', () => {
  let client: ReturnType<typeof buildClientMock>;
  let quizzesService: { findById: jest.Mock; getBatchIds: jest.Mock };
  let enrollmentsService: { findEligibleStudentIds: jest.Mock };
  let service: ConflictEngineService;

  beforeEach(() => {
    client = buildClientMock();
    quizzesService = { findById: jest.fn(), getBatchIds: jest.fn() };
    enrollmentsService = { findEligibleStudentIds: jest.fn() };

    service = new ConflictEngineService(
      client, // used as the default `this.prisma` here — tests always pass `client` explicitly instead
      quizzesService as unknown as QuizzesService,
      enrollmentsService as unknown as EnrollmentsService,
    );
  });

  it('does not query assignments at all when the eligible roster is empty', async () => {
    quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
    quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
    enrollmentsService.findEligibleStudentIds.mockResolvedValue([]);

    const result = await service.checkSessionAssembly(
      { examSessionId: 's1', quizIds: ['quiz-1'], sessionDate: SESSION_DATE, startTime: START_10, endTime: END_11 },
      client,
    );

    expect(result).toEqual({ hard: [], warnings: [] });
    expect(client.quizStudentAssignment.findMany).not.toHaveBeenCalled();
  });

  it('returns no conflicts for an empty quiz list', async () => {
    const result = await service.checkSessionAssembly(
      { examSessionId: 's1', quizIds: [], sessionDate: SESSION_DATE, startTime: START_10, endTime: END_11 },
      client,
    );

    expect(result).toEqual({ hard: [], warnings: [] });
    expect(quizzesService.findById).not.toHaveBeenCalled();
  });

  it('queries for overlap using the union of every quiz\'s eligible roster, excluding the session itself and CANCELLED sessions', async () => {
    quizzesService.findById.mockImplementation((id: string) =>
      Promise.resolve({ id, subjectId: `subj-${id}`, academicYear: '2026', semester: 1 }),
    );
    quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
    enrollmentsService.findEligibleStudentIds.mockImplementation((subjectId: string) =>
      Promise.resolve(subjectId === 'subj-quiz-1' ? ['student-1', 'student-2'] : ['student-2', 'student-3']),
    );
    client.quizStudentAssignment.findMany.mockResolvedValue([]);

    await service.checkSessionAssembly(
      { examSessionId: 's1', quizIds: ['quiz-1', 'quiz-2'], sessionDate: SESSION_DATE, startTime: START_10, endTime: END_11 },
      client,
    );

    expect(client.quizStudentAssignment.findMany).toHaveBeenCalledWith({
      where: {
        studentId: { in: expect.arrayContaining(['student-1', 'student-2', 'student-3']) },
        status: QuizStudentAssignmentStatus.ASSIGNED,
        examSessionId: { not: 's1' },
        examSession: {
          status: { not: ExamSessionStatus.CANCELLED },
          sessionDate: SESSION_DATE,
          startTime: { lt: END_11 },
          endTime: { gt: START_10 },
        },
      },
      select: { studentId: true, examSessionId: true },
      distinct: ['studentId'],
    });
    const calledWith = client.quizStudentAssignment.findMany.mock.calls[0][0];
    expect(calledWith.where.studentId.in.sort()).toEqual(['student-1', 'student-2', 'student-3']);
  });

  it('reports a STUDENT_OVERLAP hard conflict for each student with a conflicting active assignment elsewhere', async () => {
    quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
    quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
    enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1', 'student-2']);
    client.quizStudentAssignment.findMany.mockResolvedValue([
      { studentId: 'student-1', examSessionId: 'other-session-1' },
    ]);

    const result = await service.checkSessionAssembly(
      { examSessionId: 's1', quizIds: ['quiz-1'], sessionDate: SESSION_DATE, startTime: START_10, endTime: END_11 },
      client,
    );

    expect(result.hard).toEqual([
      expect.objectContaining({
        type: 'STUDENT_OVERLAP',
        studentId: 'student-1',
        conflictingExamSessionId: 'other-session-1',
      }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('is a pure/deterministic function of its inputs — same inputs, same result, across repeated calls', async () => {
    quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
    quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
    enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
    client.quizStudentAssignment.findMany.mockResolvedValue([
      { studentId: 'student-1', examSessionId: 'other-session-1' },
    ]);

    const input = { examSessionId: 's1', quizIds: ['quiz-1'], sessionDate: SESSION_DATE, startTime: START_10, endTime: END_11 };
    const results = await Promise.all([1, 2, 3].map(() => service.checkSessionAssembly(input, client)));

    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it('defaults to `this.prisma` when no explicit client is passed (the read-only dry-run path)', async () => {
    quizzesService.findById.mockResolvedValue({ id: 'quiz-1', subjectId: 'subj-1', academicYear: '2026', semester: 1 });
    quizzesService.getBatchIds.mockResolvedValue(['batch-A']);
    enrollmentsService.findEligibleStudentIds.mockResolvedValue(['student-1']);
    client.quizStudentAssignment.findMany.mockResolvedValue([]);

    await service.checkSessionAssembly({
      examSessionId: 's1',
      quizIds: ['quiz-1'],
      sessionDate: SESSION_DATE,
      startTime: START_10,
      endTime: END_11,
    });

    expect(client.quizStudentAssignment.findMany).toHaveBeenCalled(); // the constructor's `client` IS `this.prisma` in this test
  });
});

describe('ConflictEngineService.checkRoomAllocation — Phase 12 (BR-018 room double-booking, BR-022 room unavailable)', () => {
  let client: ReturnType<typeof buildClientMock>;
  let service: ConflictEngineService;

  beforeEach(() => {
    client = buildClientMock();
    service = new ConflictEngineService(client, {} as unknown as QuizzesService, {} as unknown as EnrollmentsService);
  });

  const input = { examSessionId: 's1', roomIds: ['room-1'], sessionDate: SESSION_DATE, startTime: START_10, endTime: END_11 };

  it('returns no conflicts for an empty room list, without querying anything', async () => {
    const result = await service.checkRoomAllocation({ ...input, roomIds: [] }, client);
    expect(result).toEqual({ hard: [], warnings: [] });
    expect(client.room.findMany).not.toHaveBeenCalled();
    expect(client.examSessionRoom.findMany).not.toHaveBeenCalled();
  });

  it('reports ROOM_UNAVAILABLE for a non-ACTIVE room', async () => {
    client.room.findMany.mockResolvedValue([{ id: 'room-1', status: RoomStatus.MAINTENANCE, availabilityBlocks: [] }]);
    client.examSessionRoom.findMany.mockResolvedValue([]);

    const result = await service.checkRoomAllocation(input, client);

    expect(result.hard).toEqual([expect.objectContaining({ type: 'ROOM_UNAVAILABLE', roomId: 'room-1' })]);
  });

  it('reports ROOM_UNAVAILABLE for an ACTIVE room with an overlapping availability block', async () => {
    client.room.findMany.mockResolvedValue([
      { id: 'room-1', status: RoomStatus.ACTIVE, availabilityBlocks: [{ id: 'block-1' }] },
    ]);
    client.examSessionRoom.findMany.mockResolvedValue([]);

    const result = await service.checkRoomAllocation(input, client);

    expect(result.hard).toEqual([expect.objectContaining({ type: 'ROOM_UNAVAILABLE', roomId: 'room-1' })]);
  });

  it('reports ROOM_OVERLAP for a room already allocated to a DIFFERENT overlapping session', async () => {
    client.room.findMany.mockResolvedValue([{ id: 'room-1', status: RoomStatus.ACTIVE, availabilityBlocks: [] }]);
    client.examSessionRoom.findMany.mockResolvedValue([{ roomId: 'room-1', examSessionId: 'other-session' }]);

    const result = await service.checkRoomAllocation(input, client);

    expect(result.hard).toEqual([
      expect.objectContaining({ type: 'ROOM_OVERLAP', roomId: 'room-1', conflictingExamSessionId: 'other-session' }),
    ]);
    // The overlap query excludes THIS session and matches on this session's own time window.
    expect(client.examSessionRoom.findMany).toHaveBeenCalledWith({
      where: {
        roomId: { in: ['room-1'] },
        examSessionId: { not: 's1' },
        sessionDate: SESSION_DATE,
        startTime: { lt: END_11 },
        endTime: { gt: START_10 },
      },
      select: { roomId: true, examSessionId: true },
    });
  });

  it('returns no conflicts for an ACTIVE, unblocked, unallocated room', async () => {
    client.room.findMany.mockResolvedValue([{ id: 'room-1', status: RoomStatus.ACTIVE, availabilityBlocks: [] }]);
    client.examSessionRoom.findMany.mockResolvedValue([]);

    const result = await service.checkRoomAllocation(input, client);

    expect(result).toEqual({ hard: [], warnings: [] });
  });

  it('checks multiple candidate rooms independently, reporting a conflict only for the affected one', async () => {
    client.room.findMany.mockResolvedValue([
      { id: 'room-1', status: RoomStatus.ACTIVE, availabilityBlocks: [] },
      { id: 'room-2', status: RoomStatus.MAINTENANCE, availabilityBlocks: [] },
    ]);
    client.examSessionRoom.findMany.mockResolvedValue([]);

    const result = await service.checkRoomAllocation({ ...input, roomIds: ['room-1', 'room-2'] }, client);

    expect(result.hard).toHaveLength(1);
    expect(result.hard[0].roomId).toBe('room-2');
  });
});

describe('ConflictEngineService.checkInvigilatorAssignment — Phase 16 (BR-020/BR-031 faculty double-booking)', () => {
  let client: ReturnType<typeof buildClientMock>;
  let service: ConflictEngineService;

  beforeEach(() => {
    client = buildClientMock();
    service = new ConflictEngineService(client, {} as unknown as QuizzesService, {} as unknown as EnrollmentsService);
  });

  const input = {
    facultyId: 'fac-1',
    examSessionId: 's1',
    roomId: 'room-1',
    sessionDate: SESSION_DATE,
    startTime: START_10,
    endTime: END_11,
  };

  it('returns no conflicts when the faculty has no overlapping invigilation assignment', async () => {
    client.examInvigilator.findMany.mockResolvedValue([]);

    const result = await service.checkInvigilatorAssignment(input, client);

    expect(result).toEqual({ hard: [], warnings: [] });
  });

  it('reports FACULTY_OVERLAP for an overlapping assignment in a DIFFERENT session', async () => {
    client.examInvigilator.findMany.mockResolvedValue([{ examSessionId: 'other-session', roomId: 'room-9' }]);

    const result = await service.checkInvigilatorAssignment(input, client);

    expect(result.hard).toEqual([
      expect.objectContaining({
        type: 'FACULTY_OVERLAP',
        facultyId: 'fac-1',
        roomId: 'room-9',
        conflictingExamSessionId: 'other-session',
      }),
    ]);
  });

  it('reports FACULTY_OVERLAP for a DIFFERENT room within the SAME session (identical time window)', async () => {
    client.examInvigilator.findMany.mockResolvedValue([{ examSessionId: 's1', roomId: 'room-2' }]);

    const result = await service.checkInvigilatorAssignment(input, client);

    expect(result.hard).toEqual([
      expect.objectContaining({ type: 'FACULTY_OVERLAP', roomId: 'room-2', conflictingExamSessionId: 's1' }),
    ]);
  });

  it('excludes the exact same (session, room) pair being requested — not a FACULTY_OVERLAP, the caller handles it as "already assigned"', async () => {
    client.examInvigilator.findMany.mockResolvedValue([]);

    await service.checkInvigilatorAssignment(input, client);

    expect(client.examInvigilator.findMany).toHaveBeenCalledWith({
      where: {
        facultyId: 'fac-1',
        NOT: { examSessionId: 's1', roomId: 'room-1' },
        examSession: {
          status: { not: ExamSessionStatus.CANCELLED },
          sessionDate: SESSION_DATE,
          startTime: { lt: END_11 },
          endTime: { gt: START_10 },
        },
      },
      select: { examSessionId: true, roomId: true },
    });
  });

  it('excludes CANCELLED sessions from the overlap check (a cancelled session no longer blocks the faculty)', async () => {
    client.examInvigilator.findMany.mockResolvedValue([]);

    await service.checkInvigilatorAssignment(input, client);

    const where = client.examInvigilator.findMany.mock.calls[0][0].where;
    expect(where.examSession.status).toEqual({ not: ExamSessionStatus.CANCELLED });
  });
});
