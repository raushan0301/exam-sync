import { NotFoundException } from '@nestjs/common';
import { StudentsAccessRepository } from './students-access.repository';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return { student: { findUnique: jest.fn() } } as any;
}

describe('StudentsAccessRepository (BR-045 / EC-038)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let facultyAssignmentsService: { isFacultyTeachingBatch: jest.Mock };
  let repo: StudentsAccessRepository;

  beforeEach(() => {
    prisma = buildPrismaMock();
    facultyAssignmentsService = { isFacultyTeachingBatch: jest.fn() };
    repo = new StudentsAccessRepository(
      prisma,
      facultyAssignmentsService as unknown as FacultyAssignmentsService,
    );
  });

  it('lets the student themself read their own record', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', userId: 'user-1', batchId: 'b1' });
    const actor: AuthenticatedUser = { id: 'user-1', email: 'a@b.com', roles: ['STUDENT'] };

    await expect(repo.findScoped('s1', actor)).resolves.toEqual(
      expect.objectContaining({ id: 's1' }),
    );
    // Self-match is decided before ever consulting faculty assignments.
    expect(facultyAssignmentsService.isFacultyTeachingBatch).not.toHaveBeenCalled();
  });

  it('lets ADMIN read any student record', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', userId: 'someone-else', batchId: 'b1' });
    const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@b.com', roles: ['ADMIN'] };

    await expect(repo.findScoped('s1', actor)).resolves.toEqual(
      expect.objectContaining({ id: 's1' }),
    );
  });

  it('blocks a different student with 404, not 403 (IDOR — EC-038)', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', userId: 'the-owner', batchId: 'b1' });
    const actor: AuthenticatedUser = { id: 'some-other-student', email: 'x@b.com', roles: ['STUDENT'] };

    await expect(repo.findScoped('s1', actor)).rejects.toThrow(NotFoundException);
  });

  it('lets a FACULTY member who teaches the student\'s batch read the record (Phase 5)', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', userId: 'the-owner', batchId: 'batch-A' });
    facultyAssignmentsService.isFacultyTeachingBatch.mockResolvedValue(true);
    const actor: AuthenticatedUser = { id: 'faculty-user-1', email: 'f@b.com', roles: ['FACULTY'] };

    await expect(repo.findScoped('s1', actor)).resolves.toEqual(
      expect.objectContaining({ id: 's1' }),
    );
    expect(facultyAssignmentsService.isFacultyTeachingBatch).toHaveBeenCalledWith(
      'faculty-user-1',
      'batch-A',
    );
  });

  it('blocks a FACULTY member who does NOT teach the student\'s batch, with 404', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', userId: 'the-owner', batchId: 'batch-A' });
    facultyAssignmentsService.isFacultyTeachingBatch.mockResolvedValue(false);
    const actor: AuthenticatedUser = { id: 'faculty-user-2', email: 'f2@b.com', roles: ['FACULTY'] };

    await expect(repo.findScoped('s1', actor)).rejects.toThrow(NotFoundException);
  });

  it('404s for a non-existent student id', async () => {
    prisma.student.findUnique.mockResolvedValue(null);
    const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@b.com', roles: ['ADMIN'] };

    await expect(repo.findScoped('missing', actor)).rejects.toThrow(NotFoundException);
  });
});
