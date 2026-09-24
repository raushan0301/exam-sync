import { ExamSessionOwnershipService } from './exam-session-ownership.service';
import { QuizOwnershipService } from '../quiz';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return {
    examSessionQuiz: { findMany: jest.fn() },
    examSession: { findUnique: jest.fn().mockResolvedValue({ createdByAdminId: 'someone-else' }) },
  } as any;
}

describe('ExamSessionOwnershipService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let quizOwnershipService: { isOwnerOrCoInstructor: jest.Mock };
  let service: ExamSessionOwnershipService;

  const actor: AuthenticatedUser = {
    id: 'user-1',
    email: 'f@example.com',
    roles: ['FACULTY'],
    mustChangePassword: false,
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    quizOwnershipService = { isOwnerOrCoInstructor: jest.fn() };
    service = new ExamSessionOwnershipService(
      prisma,
      quizOwnershipService as unknown as QuizOwnershipService,
    );
  });

  it('lets the FACULTY member who CREATED the session manage it even with zero active attachments (e.g. the first attach failed, leaving an orphan)', async () => {
    prisma.examSession.findUnique.mockResolvedValue({ createdByAdminId: actor.id });
    prisma.examSessionQuiz.findMany.mockResolvedValue([]);

    await expect(service.isOwnerOrCoInstructor('session-1', actor)).resolves.toBe(true);
    expect(prisma.examSessionQuiz.findMany).not.toHaveBeenCalled();
  });

  it('returns false when the session has no actively-attached quizzes at all', async () => {
    prisma.examSessionQuiz.findMany.mockResolvedValue([]);

    await expect(service.isOwnerOrCoInstructor('session-1', actor)).resolves.toBe(false);
    expect(quizOwnershipService.isOwnerOrCoInstructor).not.toHaveBeenCalled();
  });

  it('returns true when the actor owns/co-instructs at least one attached quiz', async () => {
    prisma.examSessionQuiz.findMany.mockResolvedValue([
      { quiz: { id: 'q1' } },
      { quiz: { id: 'q2' } },
    ]);
    quizOwnershipService.isOwnerOrCoInstructor
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(service.isOwnerOrCoInstructor('session-1', actor)).resolves.toBe(true);
    expect(quizOwnershipService.isOwnerOrCoInstructor).toHaveBeenCalledTimes(2);
  });

  it('short-circuits once an owning quiz is found, without checking every remaining attachment', async () => {
    prisma.examSessionQuiz.findMany.mockResolvedValue([
      { quiz: { id: 'q1' } },
      { quiz: { id: 'q2' } },
    ]);
    quizOwnershipService.isOwnerOrCoInstructor.mockResolvedValueOnce(true);

    await expect(service.isOwnerOrCoInstructor('session-1', actor)).resolves.toBe(true);
    expect(quizOwnershipService.isOwnerOrCoInstructor).toHaveBeenCalledTimes(1);
  });

  it('returns false when the actor owns/co-instructs none of the attached quizzes', async () => {
    prisma.examSessionQuiz.findMany.mockResolvedValue([{ quiz: { id: 'q1' } }]);
    quizOwnershipService.isOwnerOrCoInstructor.mockResolvedValue(false);

    await expect(service.isOwnerOrCoInstructor('session-1', actor)).resolves.toBe(false);
  });

  it('queries only the ACTIVE attachments for the given session id', async () => {
    prisma.examSessionQuiz.findMany.mockResolvedValue([]);

    await service.isOwnerOrCoInstructor('session-42', actor);

    expect(prisma.examSessionQuiz.findMany).toHaveBeenCalledWith({
      where: { examSessionId: 'session-42', isActiveAttachment: true },
      include: { quiz: true },
    });
  });
});
