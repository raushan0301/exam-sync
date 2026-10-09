import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Subject, ImportJob } from '@exam-sync/db';
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
import { DepartmentsService } from './departments.service';
import { ProgramsService } from './programs.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

export interface ListSubjectsParams {
  cursor?: string;
  limit?: number;
  search?: string;
  isActive?: boolean;
  departmentId?: string;
  programId?: string;
}

@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly departmentsService: DepartmentsService,
    private readonly programsService: ProgramsService,
    private readonly importJobsService: ImportJobsService,
  ) { }

  async create(dto: CreateSubjectDto, actor: AuthenticatedUser): Promise<Subject> {
    await this.departmentsService.findById(dto.department_id);
    if (dto.program_id) {
      await this.programsService.findById(dto.program_id);
    }

    const subject = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subject
        .create({
          data: {
            departmentId: dto.department_id,
            programId: dto.program_id,
            code: dto.code,
            name: dto.name,
            credits: dto.credits,
          },
        })
        .catch((err) => this.mapUniqueViolation(err, dto.code));

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'Subject',
          entityId: created.id,
          newValue: created,
        },
        tx,
      );

      return created;
    });

    return subject;
  }

  async findById(id: string): Promise<Subject> {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject) {
      throw new NotFoundException();
    }
    return subject;
  }

  async list(params: ListSubjectsParams): Promise<PaginatedResult<Subject>> {
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.subject.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: {
        isActive: params.isActive,
        departmentId: params.departmentId,
        programId: params.programId,
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

  async update(id: string, dto: UpdateSubjectDto, actor: AuthenticatedUser): Promise<Subject> {
    const existing = await this.findById(id);

    if (dto.department_id) {
      await this.departmentsService.findById(dto.department_id);
    }
    if (dto.program_id) {
      await this.programsService.findById(dto.program_id);
    }

    const subject = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subject
        .update({
          where: { id },
          data: {
            departmentId: dto.department_id,
            programId: dto.program_id,
            code: dto.code,
            name: dto.name,
            credits: dto.credits,
            isActive: dto.is_active,
          },
        })
        .catch((err) => this.mapUniqueViolation(err, dto.code));

      await this.auditHook.record(
        {
          actor,
          action:
            dto.is_active !== undefined && dto.is_active !== existing.isActive
              ? dto.is_active
                ? 'REACTIVATE'
                : 'DEACTIVATE'
              : 'UPDATE',
          entityType: 'Subject',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return subject;
  }

  /** See DepartmentsService.assertActiveOrThrow — same seam, for subjects (boolean flavor). */
  async assertActiveOrThrow(id: string): Promise<Subject> {
    const subject = await this.findById(id);
    if (!subject.isActive) {
      throw new ConflictException(
        `Subject "${subject.code}" is not active and cannot be referenced by new records.`,
      );
    }
    return subject;
  }

  private mapUniqueViolation(err: unknown, code: string | undefined): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(`Subject code "${code}" already exists.`);
    }
    throw err;
  }

  /** `GET /subjects/bulk-import/template` (ADMIN). */
  /** Example row is a real existing subject (+ its department's/program's real codes) — see DepartmentsService.generateBulkImportTemplate's own comment for why. */
  async generateBulkImportTemplate(): Promise<Buffer> {
    return generateExcelTemplate({
      entityName: 'Subject',
      uniqueFieldsNote: 'Unique key: code',
      columns: [
        { header: 'department_code', example: 'CSED', note: 'Must match an existing Department\'s code.' },
        { header: 'program_code', example: 'BE-COE', note: 'Optional — must match an existing Program\'s code when given, blank otherwise.' },
        { header: 'code', example: 'UCS301', note: 'Unique — cannot repeat an existing subject code.' },
        { header: 'name', example: 'Data Structures', note: 'Display name.' },
        { header: 'credits', example: '4.5', note: 'Optional — a number, whole or half-credit (e.g. 4, 3.5).' },
      ],
    });
  }

  /** `POST /subjects/bulk-import` (ADMIN). Resolves `department_code` (required) and `program_code` (optional) to ids per row. */
  async bulkImport(buffer: Buffer, actor: AuthenticatedUser): Promise<ImportJob> {
    const records = await parseExcelBuffer(buffer, ['department_code', 'code', 'name']);

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

        let programId: string | undefined;
        const programCode = record.program_code?.trim();
        if (programCode) {
          const program = await this.programsService.findByCode(programCode);
          if (!program) {
            throw new BadRequestException(`Program code '${programCode}' not found`);
          }
          programId = program.id;
        }

        let credits: number | undefined;
        const creditsRaw = record.credits?.trim();
        if (creditsRaw) {
          credits = Number(creditsRaw);
          if (!Number.isFinite(credits)) {
            throw new BadRequestException(`'credits' must be a number`);
          }
        }

        const dto: CreateSubjectDto = {
          department_id: department.id,
          program_id: programId,
          code: record.code,
          name: record.name,
          credits,
        };
        const subject = await this.create(dto, actor);
        results.push({ row: rowNumber, status: 'SUCCESS', id: subject.id });
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
      resourceType: 'subjects',
      totalRows: records.length,
      successCount,
      failureCount,
      results,
      createdByUserId: actor.id,
    });
  }
}
