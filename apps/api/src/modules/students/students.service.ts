import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { Prisma, Student, ImportJob, AcademicStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { ImportJobsService } from '../../common/import-jobs/import-jobs.service';
import { ImportRowResult } from '../../common/import-jobs/import-jobs.types';
import { ProgramsService, BatchesService } from '../academic-structure';
import { PasswordService } from '../auth';
import { StudentsAccessRepository } from './students-access.repository';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

export interface ListStudentsParams {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: AcademicStatus;
  programId?: string;
  batchId?: string;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly programsService: ProgramsService,
    private readonly batchesService: BatchesService,
    private readonly passwordService: PasswordService,
    private readonly accessRepository: StudentsAccessRepository,
    private readonly importJobsService: ImportJobsService,
  ) {}

  async create(dto: CreateStudentDto, actor: AuthenticatedUser): Promise<Student> {
    await this.programsService.findById(dto.program_id);
    const batch = await this.batchesService.findById(dto.batch_id);

    // Defensive consistency check: program_id and batch_id are independent
    // FKs on Student (ARCHITECTURE.md §AC's literal schema has both), but a
    // batch already belongs to exactly one program — letting them silently
    // diverge would be a data-integrity gap the schema itself doesn't
    // prevent. Disclosed in this phase's pre-implementation plan.
    if (batch.programId !== dto.program_id) {
      throw new ConflictException(
        `Batch does not belong to the specified program (batch's program is "${batch.programId}").`,
      );
    }

    const existingRollNumber = await this.prisma.student.findUnique({
      where: { rollNumber: dto.roll_number },
    });
    if (existingRollNumber) {
      throw new ConflictException(`Roll number "${dto.roll_number}" already exists.`);
    }

    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException(`A user with email "${dto.email}" already exists.`);
    }

    // No self-registration or invite flow exists yet (Phase 3 scope note) —
    // a random temporary password is generated and hashed through the same
    // PasswordService login uses; it is never returned to any caller.
    // Delivering it to the student (invite email) is Phase 15's job.
    const temporaryPassword = crypto.randomBytes(24).toString('base64url');
    const passwordHash = await this.passwordService.hash(temporaryPassword);

    const student = await this.prisma
      .$transaction(async (tx) => {
        const studentRole = await tx.role.findUnique({ where: { name: 'STUDENT' } });
        if (!studentRole) {
          // Seed data (packages/db/prisma/seed.ts) creates this role; if
          // it's missing, that's an environment setup defect, not a normal
          // request-time error — surfaced clearly rather than silently
          // creating a roleless user.
          throw new ConflictException(
            'STUDENT role is not seeded in this environment; cannot provision a student account.',
          );
        }

        const user = await tx.user.create({
          data: { email: dto.email, passwordHash, isActive: true },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: studentRole.id } });

        const createdStudent = await tx.student.create({
          data: {
            userId: user.id,
            name: dto.name,
            programId: dto.program_id,
            batchId: dto.batch_id,
            rollNumber: dto.roll_number,
          },
        });

        await this.auditHook.record(
          {
            actor,
            action: 'CREATE',
            entityType: 'Student',
            entityId: createdStudent.id,
            newValue: createdStudent,
          },
          tx,
        );

        return createdStudent;
      })
      .catch((err) => this.mapUniqueViolation(err, dto.roll_number));

    return student;
  }

  /** Unscoped lookup — used by ADMIN-facing endpoints (list, PATCH) where role-level RBAC already gates access. */
  async findById(id: string): Promise<Student> {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) {
      throw new NotFoundException();
    }
    return student;
  }

  /** Resource-level scoped lookup for `GET /students/{id}` (BR-045, EC-038). */
  async findByIdScoped(id: string, actor: AuthenticatedUser): Promise<Student> {
    return this.accessRepository.findScoped(id, actor);
  }

  async list(params: ListStudentsParams): Promise<PaginatedResult<Student>> {
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.student.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: {
        status: params.status,
        programId: params.programId,
        batchId: params.batchId,
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' } },
                { rollNumber: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return toPaginatedResult(rows, limit);
  }

  async update(id: string, dto: UpdateStudentDto, actor: AuthenticatedUser): Promise<Student> {
    const existing = await this.findById(id);

    const targetProgramId = dto.program_id ?? existing.programId;
    if (dto.program_id) {
      await this.programsService.findById(dto.program_id);
    }
    if (dto.batch_id) {
      const batch = await this.batchesService.findById(dto.batch_id);
      if (batch.programId !== targetProgramId) {
        throw new ConflictException(
          `Batch does not belong to the specified program (batch's program is "${batch.programId}").`,
        );
      }
    }

    const student = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.student.update({
          where: { id },
          data: {
            name: dto.name,
            programId: dto.program_id,
            batchId: dto.batch_id,
            rollNumber: dto.roll_number,
            status: dto.status,
          },
        });

        // FR-005: deactivating a student must also block their login —
        // otherwise "deactivated" is cosmetic. Kept in sync in the same
        // transaction as the status change.
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
            entityType: 'Student',
            entityId: updated.id,
            oldValue: existing,
            newValue: updated,
          },
          tx,
        );

        return updated;
      })
      .catch((err) => this.mapUniqueViolation(err, dto.roll_number));

    return student;
  }

  /**
   * `POST /students/bulk-import` (IMPLEMENTATION_PLAN.md Phase 3:
   * "async job scaffold — actual queue wiring can be minimal/synchronous
   * here, upgraded in Phase 15"). Processes the whole CSV synchronously
   * within this call — the 202+job_id response shape the controller wraps
   * this in already matches what Phase 15's real async queue will produce,
   * so no client-facing contract change is needed when that lands.
   *
   * Expected CSV columns: name,email,program_id,batch_id,roll_number
   * (header row required). Each row is processed independently — one bad
   * row never aborts the rest (EDGE_CASES.md EC-044: "valid rows are
   * committed, invalid rows are reported individually with reason").
   */
  async bulkImport(csvBuffer: Buffer, actor: AuthenticatedUser): Promise<ImportJob> {
    let records: Record<string, string>[];
    try {
      records = parseCsv(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch (err) {
      return this.importJobsService.create({
        resourceType: 'students',
        totalRows: 0,
        successCount: 0,
        failureCount: 0,
        results: [{ row: 0, status: 'FAILURE', error: `CSV could not be parsed: ${(err as Error).message}` }],
        createdByUserId: actor.id,
      });
    }

    const results: ImportRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
      const record = records[i];
      try {
        const dto: CreateStudentDto = {
          name: record.name,
          email: record.email,
          program_id: record.program_id,
          batch_id: record.batch_id,
          roll_number: record.roll_number,
        };
        const student = await this.create(dto, actor);
        results.push({ row: rowNumber, status: 'SUCCESS', id: student.id });
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
      resourceType: 'students',
      totalRows: records.length,
      successCount,
      failureCount,
      results,
      createdByUserId: actor.id,
    });
  }

  private mapUniqueViolation(err: unknown, rollNumber: string | undefined): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(`Roll number "${rollNumber}" already exists.`);
    }
    throw err;
  }
}
