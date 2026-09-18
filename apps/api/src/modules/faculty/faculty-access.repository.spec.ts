import { NotFoundException } from '@nestjs/common';
import { FacultyAccessRepository } from './faculty-access.repository';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  return { faculty: { findUnique: jest.fn() } } as any;
}

describe('FacultyAccessRepository (mirrors StudentsAccessRepository)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let repo: FacultyAccessRepository;

  beforeEach(() => {
    prisma = buildPrismaMock();
    repo = new FacultyAccessRepository(prisma);
  });

  it('lets the faculty member themself read their own record', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 'f1', userId: 'user-1' });
    const actor: AuthenticatedUser = { id: 'user-1', email: 'a@b.com', roles: ['FACULTY'] };

    await expect(repo.findScoped('f1', actor)).resolves.toEqual({ id: 'f1', userId: 'user-1' });
  });

  it('lets ADMIN read any faculty record', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 'f1', userId: 'someone-else' });
    const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@b.com', roles: ['ADMIN'] };

    await expect(repo.findScoped('f1', actor)).resolves.toEqual({ id: 'f1', userId: 'someone-else' });
  });

  it('blocks a different faculty member with 404, not 403 (IDOR)', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 'f1', userId: 'the-owner' });
    const actor: AuthenticatedUser = { id: 'some-other-faculty', email: 'x@b.com', roles: ['FACULTY'] };

    await expect(repo.findScoped('f1', actor)).rejects.toThrow(NotFoundException);
  });

  it('404s for a non-existent faculty id', async () => {
    prisma.faculty.findUnique.mockResolvedValue(null);
    const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@b.com', roles: ['ADMIN'] };

    await expect(repo.findScoped('missing', actor)).rejects.toThrow(NotFoundException);
  });
});
