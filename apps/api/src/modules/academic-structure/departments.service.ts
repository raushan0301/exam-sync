import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Department, AcademicStatus, ImportJob } from '@exam-sync/db';
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
import { parseExcelBuffer } from '../../common/bulk-import/parse-excel';
import { generateExcelTemplate } from '../../common/bulk-import/generate-template';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

export interface ListDepartmentsParams {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: AcademicStatus;
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly importJobsService: ImportJobsService,
  ) {}

  async create(dto: CreateDepartmentDto, actor: AuthenticatedUser): Promise<Department> {
    const existing = await this.prisma.department.findUnique({ where: { code: dto.code } });
    if (existing) {
      // BR-001 (🔒 DB-enforced via UNIQUE(code)) — pre-check here too so the
      // caller gets a clean, structured 409 instead of a raw constraint
      // error (IMPLEMENTATION_PLAN.md Phase 2: "uniqueness violations
      // should result in HTTP 409"). The DB constraint remains the real
      // backstop against a race between this check and the insert.
      throw new ConflictException(`Department code "${dto.code}" already exists.`);
    }

    const department = await this.prisma.$transaction(async (tx) => {
      const created = await tx.department
        .create({
          data: {
            name: dto.name,
            code: dto.code,
            metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          },
        })
        .catch((err) => this.mapUniqueViolation(err, dto.code));

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'Department',
          entityId: created.id,
          newValue: created,
        },
        tx,
      );

      return created;
    });

    return department;
  }

  async findById(id: string): Promise<Department> {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException();
    }
    return department;
  }

  /** Non-throwing lookup by code — used by bulk-import to resolve a human-readable code to an id, producing a friendly per-row error instead of a 404 crash. */
  async findByCode(code: string): Promise<Department | null> {
    return this.prisma.department.findUnique({ where: { code } });
  }

  async list(params: ListDepartmentsParams): Promise<PaginatedResult<Department>> {
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.department.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: {
        status: params.status,
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' } },
                { code: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return toPaginatedResult(rows, limit);
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actor: AuthenticatedUser,
  ): Promise<Department> {
    const existing = await this.findById(id);

    const department = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.department
        .update({
          where: { id },
          data: {
            name: dto.name,
            code: dto.code,
            status: dto.status,
            metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          },
        })
        .catch((err) => this.mapUniqueViolation(err, dto.code));

      await this.auditHook.record(
        {
          actor,
          action:
            dto.status && dto.status !== existing.status
              ? dto.status === AcademicStatus.INACTIVE
                ? 'DEACTIVATE'
                : 'REACTIVATE'
              : 'UPDATE',
          entityType: 'Department',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return department;
  }

  /**
   * Reusable downstream guard (BUSINESS_RULES.md BR-003: "deactivation
   * blocks new downstream references"). No downstream module exists yet in
   * Phase 2 — this method is the seam Phase 5 (enrollment /
   * faculty-subject-batch assignment) and others will call before creating
   * a reference to this department. Tested directly in this phase per
   * IMPLEMENTATION_PLAN.md's instruction to verify the service-level
   * behavior now, ahead of its real caller existing.
   */
  async assertActiveOrThrow(id: string): Promise<Department> {
    const department = await this.findById(id);
    if (department.status !== AcademicStatus.ACTIVE) {
      throw new ConflictException(
        `Department "${department.code}" is not active and cannot be referenced by new records.`,
      );
    }
    return department;
  }

  private mapUniqueViolation(err: unknown, code: string | undefined): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(`Department code "${code}" already exists.`);
    }
    throw err;
  }

  /** `GET /departments/bulk-import/template` (ADMIN). */
  /**
   * The example row is a REAL existing department (falls back to a
   * plainly-fictional placeholder only when the table is genuinely empty)
   * — a real code always resolves against the real FK targets downstream
   * bulk imports validate against, so the example is never accidentally
   * invalid, and an admin who forgets to delete it before uploading gets
   * a clean "already exists" failure instead of a confusing FK error.
   *
   * `status: ACTIVE` + newest-first: a stale/deactivated/inconsistently-
   * coded row (e.g. an early duplicate created before a real catalog
   * import, with a different naming convention than everything since)
   * must never be the one picked — a real incident this exact template
   * hit: an old duplicate Program row ("BECOE", no hyphen, unused) was
   * `findFirst({orderBy: 'asc'})`'s pick over the real, hyphenated
   * "BE-COE" every other program/batch/student actually uses. Every
   * `generateBulkImportTemplate` in this codebase now filters the same
   * way for the same reason (see each one's own reference to this note).
   */
  async generateBulkImportTemplate(): Promise<Buffer> {
    return generateExcelTemplate({
      entityName: 'Department',
      uniqueFieldsNote: 'Unique key: code',
      columns: [
        { header: 'code', example: 'CSED', note: 'Unique — cannot repeat an existing department code.' },
        { header: 'name', example: 'COMPUTER SCIENCE AND ENGINEERING', note: 'Display name.' },
      ],
    });
  }

  /**
   * `POST /departments/bulk-import` (ADMIN). Parses the uploaded .xlsx,
   * processes rows independently via the existing `create()` method — one
   * bad row never aborts the rest — and records the outcome via the
   * generic ImportJobsService (same pattern as students.service.ts).
   */
  async bulkImport(buffer: Buffer, actor: AuthenticatedUser): Promise<ImportJob> {
    const records = await parseExcelBuffer(buffer, ['code', 'name']);

    const results: ImportRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2;
      const record = records[i];
      try {
        const dto: CreateDepartmentDto = { code: record.code, name: record.name };
        const department = await this.create(dto, actor);
        results.push({ row: rowNumber, status: 'SUCCESS', id: department.id });
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
      resourceType: 'departments',
      totalRows: records.length,
      successCount,
      failureCount,
      results,
      createdByUserId: actor.id,
    });
  }
}
