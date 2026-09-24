import { NotFoundException } from '@nestjs/common';
import { FacultyController } from './faculty.controller';
import { FacultyService } from './faculty.service';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const facultyActor: AuthenticatedUser = { id: 'user-1', email: 'f@example.com', roles: [ROLE.FACULTY], mustChangePassword: false };

describe('FacultyController.me — resolves the caller\'s own Faculty row (GET /users/me has no facultyId field)', () => {
  let facultyService: { findByUserId: jest.Mock };
  let controller: FacultyController;

  beforeEach(() => {
    facultyService = { findByUserId: jest.fn() };
    controller = new FacultyController(facultyService as unknown as FacultyService);
  });

  it('returns the Faculty row for a real faculty user', async () => {
    facultyService.findByUserId.mockResolvedValue({ id: 'fac-1', userId: 'user-1', name: 'Dr. Smith' });

    const result = await controller.me(facultyActor);

    expect(facultyService.findByUserId).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ id: 'fac-1', userId: 'user-1', name: 'Dr. Smith' });
  });

  it('404s when the caller has no Faculty profile row', async () => {
    facultyService.findByUserId.mockResolvedValue(null);

    await expect(controller.me(facultyActor)).rejects.toThrow(NotFoundException);
  });
});
