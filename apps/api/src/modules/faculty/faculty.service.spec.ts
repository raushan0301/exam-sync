import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, AcademicStatus } from '@exam-sync/db';
import { FacultyService } from './faculty.service';
import { DepartmentsService } from '../academic-structure';
import { PasswordService } from '../auth';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { FacultyAccessRepository } from './faculty-access.repository';
import { AuthenticatedUser } from '../../common/auth/auth.types';

function buildPrismaMock() {
  const tx = {
    role: { findUnique: jest.fn() },
    user: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    userRole: { create: jest.fn() },
    faculty: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  };
  return { ...tx, $transaction: jest.fn((cb: any) => cb(tx)) } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'] };

describe('FacultyService (mirrors StudentsService)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let departmentsService: { findById: jest.Mock };
  let passwordService: { hash: jest.Mock };
  let accessRepository: any;
  let service: FacultyService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    departmentsService = { findById: jest.fn() };
    passwordService = { hash: jest.fn().mockResolvedValue('hashed-temp-password') };
    accessRepository = {};

    service = new FacultyService(
      prisma,
      auditHook as unknown as AuditHookService,
      departmentsService as unknown as DepartmentsService,
      passwordService as unknown as PasswordService,
      accessRepository as FacultyAccessRepository,
    );
  });

  describe('create', () => {
    const dto = {
      name: 'Dr. Grace Hopper',
      email: 'grace@example.com',
      department_id: 'd1',
      employee_code: 'EMP-001',
    };

    it('validates the department exists before creating (404 on bad dept)', async () => {
      departmentsService.findById.mockRejectedValue(new NotFoundException());
      await expect(service.create(dto, actor)).rejects.toThrow();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a duplicate employee_code pre-check with 409', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.faculty.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate email pre-check with 409', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.faculty.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
    });

    it('creates User + UserRole(FACULTY) + Faculty atomically, never returning the password', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.faculty.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-faculty', name: 'FACULTY' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', email: dto.email });
      const createdFaculty = { id: 'faculty-1', name: dto.name, employeeCode: dto.employee_code };
      prisma.faculty.create.mockResolvedValue(createdFaculty);

      const result = await service.create(dto, actor);

      expect(result).toEqual(createdFaculty);
      expect(JSON.stringify(result)).not.toMatch(/password/i);
      expect(prisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', roleId: 'role-faculty' },
      });
      expect(passwordService.hash).toHaveBeenCalled();
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Faculty' }),
        expect.anything(),
      );
    });

    it('fails clearly if the FACULTY role is not seeded', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.faculty.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('maps a raw employee_code unique-constraint DB error to 409', async () => {
      departmentsService.findById.mockResolvedValue({ id: 'd1' });
      prisma.faculty.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

      await expect(service.create(dto, actor)).rejects.toThrow(ConflictException);
    });
  });

  describe('update / deactivation', () => {
    it('deactivating a faculty member also disables their linked User login', async () => {
      const existing = { id: 'f1', userId: 'user-1', departmentId: 'd1', status: AcademicStatus.ACTIVE };
      prisma.faculty.findUnique.mockResolvedValue(existing);
      prisma.faculty.update.mockResolvedValue({ ...existing, status: AcademicStatus.INACTIVE });

      await service.update('f1', { status: AcademicStatus.INACTIVE }, actor);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
      expect(auditHook.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE' }),
        expect.anything(),
      );
    });

    it('reactivating a faculty member re-enables their linked User login', async () => {
      const existing = { id: 'f1', userId: 'user-1', departmentId: 'd1', status: AcademicStatus.INACTIVE };
      prisma.faculty.findUnique.mockResolvedValue(existing);
      prisma.faculty.update.mockResolvedValue({ ...existing, status: AcademicStatus.ACTIVE });

      await service.update('f1', { status: AcademicStatus.ACTIVE }, actor);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: true },
      });
    });

    it('validates the new department on reassignment', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 'f1', userId: 'user-1', departmentId: 'd1', status: 'ACTIVE' });
      departmentsService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.update('f1', { department_id: 'missing-dept' }, actor)).rejects.toThrow();
    });
  });
});
