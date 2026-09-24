import { ConflictException, NotFoundException } from '@nestjs/common';
import { buildXlsxBuffer, readTemplateExampleRow } from '../../common/bulk-import/test-utils';
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
    faculty: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  return { ...tx, $transaction: jest.fn((cb: any) => cb(tx)) } as any;
}

const actor: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.com', roles: ['ADMIN'], mustChangePassword: false };

describe('FacultyService (mirrors StudentsService)', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let auditHook: { record: jest.Mock };
  let departmentsService: { findById: jest.Mock; findByCode: jest.Mock };
  let passwordService: { hash: jest.Mock };
  let accessRepository: any;
  let importJobsService: { create: jest.Mock };
  let service: FacultyService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    auditHook = { record: jest.fn() };
    departmentsService = { findById: jest.fn(), findByCode: jest.fn() };
    passwordService = { hash: jest.fn().mockResolvedValue('hashed-temp-password') };
    accessRepository = {};
    importJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    service = new FacultyService(
      prisma,
      auditHook as unknown as AuditHookService,
      departmentsService as unknown as DepartmentsService,
      passwordService as unknown as PasswordService,
      accessRepository as FacultyAccessRepository,
      importJobsService as any,
    );
  });

  describe('generateBulkImportTemplate', () => {
    it('uses a real existing faculty member (+ their department\'s real code) as the example row', async () => {
      prisma.faculty.findFirst.mockResolvedValue({
        employeeCode: 'EMP2050', name: 'Dr. Real Person',
        department: { code: 'ECE' }, user: { email: 'real.person@example.edu' },
      });

      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());

      expect(row.department_code).toBe('ECE');
      expect(row.employee_code).toBe('EMP2050');
      expect(row.name).toBe('Dr. Real Person');
      expect(row.email).toBe('real.person@example.edu');
    });

    it('falls back to a fictional placeholder when the table is genuinely empty', async () => {
      prisma.faculty.findFirst.mockResolvedValue(null);

      const row = await readTemplateExampleRow(await service.generateBulkImportTemplate());

      expect(row.employee_code).toBe('EMP1001');
    });
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
      expect(passwordService.hash).toHaveBeenCalledWith('EMP-001_dr.gracehopper');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: dto.email, passwordHash: 'hashed-temp-password', isActive: true, mustChangePassword: true },
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

  describe('bulkImport', () => {
    it('resolves department_code to department_id and imports the row', async () => {
      departmentsService.findByCode.mockResolvedValue({ id: 'd1', code: 'CSE' });
      prisma.faculty.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-faculty', name: 'FACULTY' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', email: 'jane@example.com' });
      prisma.faculty.create.mockResolvedValue({ id: 'f1', employeeCode: 'EMP1' });
      const buffer = await buildXlsxBuffer(
        ['department_code', 'employee_code', 'name', 'email'],
        [['CSE', 'EMP1', 'Jane Doe', 'jane@example.com']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 1,
          failureCount: 0,
          results: [{ row: 2, status: 'SUCCESS', id: 'f1' }],
        }),
      );
    });

    it('reports a duplicate employee_code as a per-row FAILURE', async () => {
      departmentsService.findByCode.mockResolvedValue({ id: 'd1', code: 'CSE' });
      prisma.faculty.findUnique.mockResolvedValue({ id: 'existing', employeeCode: 'EMP1' });
      const buffer = await buildXlsxBuffer(
        ['department_code', 'employee_code', 'name', 'email'],
        [['CSE', 'EMP1', 'Jane Doe', 'jane@example.com']],
      );

      await service.bulkImport(buffer, actor);

      expect(importJobsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          successCount: 0,
          failureCount: 1,
          results: [expect.objectContaining({ row: 2, status: 'FAILURE' })],
        }),
      );
    });
  });
});
