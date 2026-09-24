import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Faculty, AcademicStatus, ImportJob } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { generateDefaultPassword } from '../../common/auth/generate-default-password';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { ImportRowResult } from '../../common/import-jobs/import-jobs.types';
import { parseExcelBuffer } from '../../common/bulk-import/parse-excel';
import { generateExcelTemplate } from '../../common/bulk-import/generate-template';
import { DepartmentsService } from '../academic-structure';
import { PasswordService } from '../auth';
import { FacultyAccessRepository } from './faculty-access.repository';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';

export interface ListFacultyParams {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: AcademicStatus;
  departmentId?: string;
}

/**
 * Mirrors StudentsService (Phase 3) structurally: atomic User+Role+entity
 * provisioning, unique-code pre-check + DB-constraint backstop, deactivation
 * synced to the linked login, resource-level scoped lookup. See that
 * service's comments for the rationale behind each of these — repeated
 * only where faculty's shape genuinely differs (department instead of
 * program/batch, employee_code instead of roll_number, FACULTY role).
 */
@Injectable()
export class FacultyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly departmentsService: DepartmentsService,
    private readonly passwordService: PasswordService,
    private readonly accessRepository: FacultyAccessRepository,
    private readonly importJobsService: ImportJobsService,
  ) {}

  async create(dto: CreateFacultyDto, actor: AuthenticatedUser): Promise<Faculty> {
    await this.departmentsService.findById(dto.department_id);

    const existingEmployeeCode = await this.prisma.faculty.findUnique({
      where: { employeeCode: dto.employee_code },
    });
    if (existingEmployeeCode) {
      throw new ConflictException(`Employee code "${dto.employee_code}" already exists.`);
    }

    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException(`A user with email "${dto.email}" already exists.`);
    }

    // Deterministic default password (employee_code + name, lowercase, no
    // spaces) — see generateDefaultPassword. mustChangePassword forces a
    // real password to be set on first login.
    const temporaryPassword = generateDefaultPassword(dto.employee_code, dto.name);
    const passwordHash = await this.passwordService.hash(temporaryPassword);

    const faculty = await this.prisma
      .$transaction(async (tx) => {
        const facultyRole = await tx.role.findUnique({ where: { name: 'FACULTY' } });
        if (!facultyRole) {
          throw new ConflictException(
            'FACULTY role is not seeded in this environment; cannot provision a faculty account.',
          );
        }

        const user = await tx.user.create({
          data: { email: dto.email, passwordHash, isActive: true, mustChangePassword: true },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: facultyRole.id } });

        const createdFaculty = await tx.faculty.create({
          data: {
            userId: user.id,
            name: dto.name,
            departmentId: dto.department_id,
            employeeCode: dto.employee_code,
          },
        });

        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'Faculty',
            entityId: createdFaculty.id,
            newValue: createdFaculty,
          },
          tx,
        );

        return createdFaculty;
      })
      .catch((err) => this.mapUniqueViolation(err, dto.employee_code));

    return faculty;
  }

  /** Unscoped lookup — used by ADMIN-facing endpoints (list, PATCH) where role-level RBAC already gates access. */
  async findById(id: string): Promise<Faculty> {
    const faculty = await this.prisma.faculty.findUnique({ where: { id } });
    if (!faculty) {
      throw new NotFoundException();
    }
    return faculty;
  }

  /**
   * Resolves the Faculty row for an authenticated actor's user id. Added in
   * Phase 6: quiz ownership (BR-010, "created_by_faculty_id") is keyed by
   * Faculty row id, but AuthenticatedUser only carries a user id — every
   * quiz-authorization check needs this mapping. Returns null (not a
   * thrown error) for a non-faculty actor; callers decide what that means
   * in their own context (e.g. "this actor can never own a quiz").
   */
  async findByUserId(userId: string): Promise<Faculty | null> {
    return this.prisma.faculty.findUnique({ where: { userId } });
  }

  /** Resource-level scoped lookup for `GET /faculty/{id}` (mirrors BR-045's pattern for faculty). */
  async findByIdScoped(id: string, actor: AuthenticatedUser): Promise<Faculty> {
    return this.accessRepository.findScoped(id, actor);
  }

  async list(params: ListFacultyParams): Promise<PaginatedResult<Faculty>> {
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.faculty.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: {
        status: params.status,
        departmentId: params.departmentId,
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' } },
                { employeeCode: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return toPaginatedResult(rows, limit);
  }

  async update(id: string, dto: UpdateFacultyDto, actor: AuthenticatedUser): Promise<Faculty> {
    const existing = await this.findById(id);

    if (dto.department_id) {
      await this.departmentsService.findById(dto.department_id);
    }

    const faculty = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.faculty.update({
          where: { id },
          data: {
            name: dto.name,
            departmentId: dto.department_id,
            employeeCode: dto.employee_code,
            status: dto.status,
          },
        });

        // Mirrors students.service.ts FR-005 pattern: deactivating a
        // faculty member must also block their login, not just flip a
        // cosmetic status flag. EDGE_CASES.md EC-049 ("faculty
        // deleted/inactivated after quiz creation") explicitly requires
        // existing quizzes/history to remain intact — soft status change
        // here, never a physical delete, satisfies that.
        if (dto.status && dto.status !== existing.status) {
          await tx.user.update({
            where: { id: existing.userId },
            data: { isActive: dto.status === AcademicStatus.ACTIVE },
          });
        }

        await this.auditHook.record(
          {
            actor,
            action:
              dto.status && dto.status !== existing.status
                ? dto.status === AcademicStatus.INACTIVE
                  ? 'DEACTIVATE'
                  : 'REACTIVATE'
                : 'UPDATE',
            entityType: 'Faculty',
            entityId: updated.id,
            oldValue: existing,
            newValue: updated,
          },
          tx,
        );

        return updated;
      })
      .catch((err) => this.mapUniqueViolation(err, dto.employee_code));

    return faculty;
  }

  private mapUniqueViolation(err: unknown, employeeCode: string | undefined): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(`Employee code "${employeeCode}" already exists.`);
    }
    throw err;
  }

  /** `GET /faculty/bulk-import/template` (ADMIN). */
  /** Example row is a real existing faculty member (+ their department's real code) — see DepartmentsService.generateBulkImportTemplate's own comment for why. */
  async generateBulkImportTemplate(): Promise<Buffer> {
    const sample = await this.prisma.faculty.findFirst({
      where: { status: 'ACTIVE', department: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'desc' },
      include: { department: true, user: true },
    });
    return generateExcelTemplate({
      entityName: 'Faculty',
      uniqueFieldsNote: 'Unique key: employee_code (email must also be unique)',
      columns: [
        { header: 'department_code', example: sample?.department.code ?? 'CSE', note: 'Must match an existing Department\'s code.' },
        { header: 'employee_code', example: sample?.employeeCode ?? 'EMP1001', note: 'Unique — cannot repeat an existing employee code.' },
        { header: 'name', example: sample?.name ?? 'Dr. Jane Doe', note: 'Full name.' },
        { header: 'email', example: sample?.user.email ?? 'jane.doe@example.com', note: 'Unique — used to provision the faculty login.' },
      ],
    });
  }

  /** `POST /faculty/bulk-import` (ADMIN). Resolves `department_code` -> `department_id` per row. */
  async bulkImport(buffer: Buffer, actor: AuthenticatedUser): Promise<ImportJob> {
    const records = await parseExcelBuffer(buffer, ['department_code', 'employee_code', 'name', 'email']);

    const results: ImportRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2;
      const record = records[i];
      try {
        const department = await this.departmentsService.findByCode(record.department_code);
        if (!department) {
          throw new BadRequestException(`Department code '${record.department_code}' not found`);
        }

        const dto: CreateFacultyDto = {
          name: record.name,
          email: record.email,
          department_id: department.id,
          employee_code: record.employee_code,
        };
        const faculty = await this.create(dto, actor);
        results.push({ row: rowNumber, status: 'SUCCESS', id: faculty.id });
        successCount++;
      } catch (err) {
        results.push({
          row: rowNumber,
          status: 'FAILURE',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        failureCount++;
      }
    }

    return this.importJobsService.create({
      resourceType: 'faculty',
      totalRows: records.length,
      successCount,
      failureCount,
      results,
      createdByUserId: actor.id,
    });
  }
}
