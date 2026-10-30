import { NavCountsService } from './nav-counts.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return {
    notification: { count: jest.fn().mockResolvedValue(3) },
    quiz: { count: jest.fn().mockResolvedValue(0) },
    examSessionSuspensionRequest: { count: jest.fn().mockResolvedValue(0) },
    examSessionRoomRequest: { count: jest.fn().mockResolvedValue(0) },
    incident: { count: jest.fn().mockResolvedValue(0) },
    faculty: { findUnique: jest.fn() },
    facultySubjectBatchAssignment: { count: jest.fn().mockResolvedValue(0) },
    examInvigilator: { count: jest.fn().mockResolvedValue(0) },
    userNavSeen: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

const user = (roles: string[]): AuthenticatedUser => ({ id: 'u1', email: 'u@x.test', roles, mustChangePassword: false });

describe('NavCountsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: NavCountsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new NavCountsService(prisma);
  });

  it('gives a student only the unread notification count', async () => {
    const counts = await service.countsFor(user(['STUDENT']));
    expect(counts).toEqual({ notifications: 3 });
    expect(prisma.quiz.count).not.toHaveBeenCalled();
  });

  it('gives an admin the queues that are waiting on them', async () => {
    prisma.quiz.count.mockResolvedValue(4);
    prisma.examSessionSuspensionRequest.count.mockResolvedValue(2);
    prisma.examSessionRoomRequest.count.mockResolvedValue(1);
    prisma.incident.count.mockResolvedValue(5);

    const counts = await service.countsFor(user(['ADMIN']));

    expect(counts).toEqual({
      notifications: 3,
      'quizzes.approval': 4,
      'suspension-requests': 2,
      'room-requests': 1,
      incidents: 5,
    });
    expect(prisma.quiz.count).toHaveBeenCalledWith({ where: { status: 'SUBMITTED' } });
  });

  it('counts only faculty rows created after the last-seen time', async () => {
    const seen = new Date('2026-10-10T00:00:00Z');
    prisma.faculty.findUnique.mockResolvedValue({ id: 'f1' });
    prisma.userNavSeen.findMany.mockResolvedValue([
      { key: 'assignments', seenAt: seen },
      { key: 'invigilation-duties', seenAt: seen },
      { key: 'incidents', seenAt: seen },
    ]);
    prisma.facultySubjectBatchAssignment.count.mockResolvedValue(2);
    prisma.examInvigilator.count.mockResolvedValue(1);
    prisma.quiz.count.mockResolvedValue(3);

    const counts = await service.countsFor(user(['FACULTY']));

    expect(counts).toMatchObject({ assignments: 2, 'invigilation-duties': 1, 'my-quizzes': 3, incidents: 0 });
    expect(prisma.facultySubjectBatchAssignment.count).toHaveBeenCalledWith({
      where: { facultyId: 'f1', endedAt: null, createdAt: { gt: seen } },
    });
    expect(prisma.quiz.count).toHaveBeenCalledWith({ where: { createdByFacultyId: 'f1', status: 'REJECTED' } });
    expect(prisma.userNavSeen.createMany).not.toHaveBeenCalled();
  });

  it('baselines never-seen keys to now so existing history is not "new"', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 'f1' });

    await service.countsFor(user(['FACULTY']));

    const data = prisma.userNavSeen.createMany.mock.calls[0][0].data;
    expect(data.map((d: any) => d.key).sort()).toEqual(['assignments', 'incidents', 'invigilation-duties']);
    expect(prisma.userNavSeen.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('markSeen upserts the row for this user and key', async () => {
    await service.markSeen(user(['FACULTY']), 'assignments');
    expect(prisma.userNavSeen.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_key: { userId: 'u1', key: 'assignments' } } }),
    );
  });
});
