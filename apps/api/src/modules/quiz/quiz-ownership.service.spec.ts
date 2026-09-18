import { QuizOwnershipService } from './quiz-ownership.service';
import { FacultyService } from '../faculty';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return { quizBatch: { findMany: jest.fn() } } as any;
}

describe('QuizOwnershipService (ARCHITECTURE.md §AF)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let facultyService: { findByUserId: jest.Mock };
  let facultyAssignmentsService: { hasActiveCoInstructorAssignment: jest.Mock };
  let service: QuizOwnershipService;

  const actor: AuthenticatedUser = { id: 'user-1', email: 'f@example.com', roles: ['FACULTY'] };

  beforeEach(() => {
    prisma = buildPrismaMock();
    facultyService = { findByUserId: jest.fn() };
    facultyAssignmentsService = { hasActiveCoInstructorAssignment: jest.fn() };
    service = new QuizOwnershipService(
      prisma,
      facultyService as unknown as FacultyService,
      facultyAssignmentsService as unknown as FacultyAssignmentsService,
    );
  });

  it('returns false when the actor has no Faculty account at all', async () => {
    facultyService.findByUserId.mockResolvedValue(null);
    const quiz = { id: 'q1', createdByFacultyId: 'someone', subjectId: 's1' } as any;

    await expect(service.isOwnerOrCoInstructor(quiz, actor)).resolves.toBe(false);
    expect(facultyAssignmentsService.hasActiveCoInstructorAssignment).not.toHaveBeenCalled();
  });

  it('returns true for the creating faculty, without consulting co-instructor assignments', async () => {
    facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
    const quiz = { id: 'q1', createdByFacultyId: 'faculty-1', subjectId: 's1' } as any;

    await expect(service.isOwnerOrCoInstructor(quiz, actor)).resolves.toBe(true);
    expect(prisma.quizBatch.findMany).not.toHaveBeenCalled();
  });

  it('returns true for a faculty holding an active CO_INSTRUCTOR assignment on the quiz\'s subject+batch', async () => {
    facultyService.findByUserId.mockResolvedValue({ id: 'faculty-2' });
    prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
    facultyAssignmentsService.hasActiveCoInstructorAssignment.mockResolvedValue(true);
    const quiz = { id: 'q1', createdByFacultyId: 'faculty-1', subjectId: 's1' } as any;

    await expect(service.isOwnerOrCoInstructor(quiz, actor)).resolves.toBe(true);
    expect(facultyAssignmentsService.hasActiveCoInstructorAssignment).toHaveBeenCalledWith(
      'faculty-2',
      's1',
      ['batch-A'],
    );
  });

  it('returns false for an unrelated faculty with no co-instructor assignment', async () => {
    facultyService.findByUserId.mockResolvedValue({ id: 'faculty-3' });
    prisma.quizBatch.findMany.mockResolvedValue([{ batchId: 'batch-A' }]);
    facultyAssignmentsService.hasActiveCoInstructorAssignment.mockResolvedValue(false);
    const quiz = { id: 'q1', createdByFacultyId: 'faculty-1', subjectId: 's1' } as any;

    await expect(service.isOwnerOrCoInstructor(quiz, actor)).resolves.toBe(false);
  });
});
