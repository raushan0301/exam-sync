import { NotFoundException } from '@nestjs/common';
import { ExamSessionsAccessRepository } from './exam-sessions-access.repository';
import { FacultyService } from '../faculty';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return {
    examSession: { findUnique: jest.fn() },
    examSessionQuiz: { count: jest.fn().mockResolvedValue(0) },
    examInvigilator: { count: jest.fn().mockResolvedValue(0) },
  } as any;
}

describe('ExamSessionsAccessRepository ("scoped" per API_CONTRACT.md)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let facultyService: { findByUserId: jest.Mock };
  let repo: ExamSessionsAccessRepository;

  beforeEach(() => {
    prisma = buildPrismaMock();
    facultyService = { findByUserId: jest.fn() };
    repo = new ExamSessionsAccessRepository(prisma, facultyService as unknown as FacultyService);
  });

  it('lets ADMIN view any session', async () => {
    prisma.examSession.findUnique.mockResolvedValue({ id: 's1' });
    const admin: AuthenticatedUser = { id: 'admin-1', email: 'a@b.com', roles: ['ADMIN'], mustChangePassword: false };

    await expect(repo.findScoped('s1', admin)).resolves.toEqual({ id: 's1' });
    expect(facultyService.findByUserId).not.toHaveBeenCalled();
  });

  it('lets a FACULTY member who owns an actively-attached quiz view the session', async () => {
    prisma.examSession.findUnique.mockResolvedValue({ id: 's1' });
    facultyService.findByUserId.mockResolvedValue({ id: 'faculty-1' });
    prisma.examSessionQuiz.count.mockResolvedValue(1);
    const faculty: AuthenticatedUser = { id: 'user-1', email: 'f@b.com', roles: ['FACULTY'], mustChangePassword: false };

    await expect(repo.findScoped('s1', faculty)).resolves.toEqual({ id: 's1' });
    expect(prisma.examSessionQuiz.count).toHaveBeenCalledWith({
      where: { examSessionId: 's1', isActiveAttachment: true, quiz: { createdByFacultyId: 'faculty-1' } },
    });
  });

  it('lets a FACULTY member with no attached quiz but assigned as an INVIGILATOR view the session (attendance-marking access)', async () => {
    prisma.examSession.findUnique.mockResolvedValue({ id: 's1' });
    facultyService.findByUserId.mockResolvedValue({ id: 'faculty-3' });
    prisma.examSessionQuiz.count.mockResolvedValue(0);
    prisma.examInvigilator.count.mockResolvedValue(1);
    const faculty: AuthenticatedUser = { id: 'user-3', email: 'f3@b.com', roles: ['FACULTY'], mustChangePassword: false };

    await expect(repo.findScoped('s1', faculty)).resolves.toEqual({ id: 's1' });
    expect(prisma.examInvigilator.count).toHaveBeenCalledWith({
      where: { examSessionId: 's1', facultyId: 'faculty-3' },
    });
  });

  it('blocks a FACULTY member with no attached quiz and no invigilator assignment in this session — 404, not 403', async () => {
    prisma.examSession.findUnique.mockResolvedValue({ id: 's1', createdByAdminId: 'someone-else' });
    facultyService.findByUserId.mockResolvedValue({ id: 'faculty-2' });
    prisma.examSessionQuiz.count.mockResolvedValue(0);
    prisma.examInvigilator.count.mockResolvedValue(0);
    const faculty: AuthenticatedUser = { id: 'user-2', email: 'f2@b.com', roles: ['FACULTY'], mustChangePassword: false };

    await expect(repo.findScoped('s1', faculty)).rejects.toThrow(NotFoundException);
  });

  it('lets the FACULTY member who CREATED the session view it even with no attached quiz yet (e.g. the attach failed and left it an orphan)', async () => {
    prisma.examSession.findUnique.mockResolvedValue({ id: 's1', createdByAdminId: 'user-4' });
    const faculty: AuthenticatedUser = { id: 'user-4', email: 'f4@b.com', roles: ['FACULTY'], mustChangePassword: false };

    await expect(repo.findScoped('s1', faculty)).resolves.toEqual({ id: 's1', createdByAdminId: 'user-4' });
    expect(facultyService.findByUserId).not.toHaveBeenCalled();
  });

  it('blocks a non-faculty, non-admin actor entirely', async () => {
    prisma.examSession.findUnique.mockResolvedValue({ id: 's1' });
    facultyService.findByUserId.mockResolvedValue(null);
    const student: AuthenticatedUser = { id: 'user-3', email: 's@b.com', roles: ['STUDENT'], mustChangePassword: false };

    await expect(repo.findScoped('s1', student)).rejects.toThrow(NotFoundException);
  });

  it('404s for a non-existent session', async () => {
    prisma.examSession.findUnique.mockResolvedValue(null);
    const admin: AuthenticatedUser = { id: 'admin-1', email: 'a@b.com', roles: ['ADMIN'], mustChangePassword: false };

    await expect(repo.findScoped('missing', admin)).rejects.toThrow(NotFoundException);
  });
});
