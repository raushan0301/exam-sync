import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Batch, AcademicStatus, ImportJob } from '@exam-sync/db';
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
import { ProgramsService } from './programs.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';

export interface ListBatchesParams {
  cursor?: string;
  limit?: number;
  status?: AcademicStatus;
  programId?: string;
  year?: string;
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly programsService: ProgramsService,
    private readonly importJobsService: ImportJobsService,
  ) { }

  async create(dto: CreateBatchDto, actor: AuthenticatedUser): Promise<Batch> {
    // Confirms the program exists — Batch belongs to exactly one Program.
    const program = await this.programsService.findById(dto.program_id);

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.batch
        .create({
          data: {
            programId: dto.program_id,
            year: dto.year,
            section: dto.section,
            subsection: dto.subsection,
          },
        })
        .catch((err) => this.mapUniqueViolation(err, { ...dto, programName: program.name }));

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'Batch',
          entityId: created.id,
          newValue: created,
        },
        tx,
      );

      return created;
    });

    return batch;
  }

  async findById(id: string): Promise<Batch> {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) {
      throw new NotFoundException();
    }
    return batch;
  }

  /** Non-throwing lookup by the (program_id, year, section, subsection) composite unique key — used by bulk-import (e.g. Student rows referencing a batch by program/year/section/subsection rather than UUID). */
  async findByProgramYearSectionSubsection(
    programId: string,
    year: string,
    section: string,
    subsection: string,
  ): Promise<Batch | null> {
    return this.prisma.batch.findUnique({
      where: { programId_year_section_subsection: { programId, year, section, subsection } },
    });
  }

  async list(params: ListBatchesParams): Promise<PaginatedResult<Batch>> {
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.batch.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: {
        status: params.status,
        programId: params.programId,
        year: params.year,
      },
      orderBy: { createdAt: 'asc' },
    });

    return toPaginatedResult(rows, limit);
  }

  async update(id: string, dto: UpdateBatchDto, actor: AuthenticatedUser): Promise<Batch> {
    const existing = await this.findById(id);

    let programName: string | undefined;
    if (dto.program_id) {
      programName = (await this.programsService.findById(dto.program_id)).name;
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.batch
        .update({
          where: { id },
          data: {
            programId: dto.program_id,
            year: dto.year,
            section: dto.section,
            subsection: dto.subsection,
            status: dto.status,
          },
        })
        .catch((err) =>
          this.mapUniqueViolation(err, {
            program_id: dto.program_id,
            programName,
            year: dto.year,
            section: dto.section,
            subsection: dto.subsection,
          }),
        );

      await this.auditHook.record(
        {
          actor,
          action:
            dto.status && dto.status !== existing.status
              ? dto.status === AcademicStatus.INACTIVE
                ? 'DEACTIVATE'
                : 'REACTIVATE'
              : 'UPDATE',
          entityType: 'Batch',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return batch;
  }

  /** See DepartmentsService.assertActiveOrThrow — same seam, for batches. */
  async assertActiveOrThrow(id: string): Promise<Batch> {
    const batch = await this.findById(id);
    if (batch.status !== AcademicStatus.ACTIVE) {
      throw new ConflictException(
        `Batch (${batch.year}/${batch.section}) is not active and cannot be referenced by new records.`,
      );
    }
    return batch;
  }

  private mapUniqueViolation(
    err: unknown,
    ident: { program_id?: string; programName?: string; year?: string; section?: string; subsection?: string },
  ): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        `A batch for program "${ident.programName ?? ident.program_id}", year ${ident.year}, section "${ident.section}", subsection "${ident.subsection}" already exists.`,
      );
    }
    throw err;
  }

  /** `GET /batches/bulk-import/template` (ADMIN). */
  /** Example row is a real existing batch (+ its program's real code) — see DepartmentsService.generateBulkImportTemplate's own comment for why. */
  async generateBulkImportTemplate(): Promise<Buffer> {
    return generateExcelTemplate({
      entityName: 'Batch',
      uniqueFieldsNote: 'Unique combination: program code + year + section + subsection',
      columns: [
        { header: 'program_code', example: 'BE-COE', note: 'Must match an existing Program\'s code.' },
        { header: 'year', example: '2023-2027', note: 'Cohort label — a single year ("2026") or a span ("2023-2027").' },
        { header: 'section', example: '4C2', note: 'Coarse section, groups multiple subsections.' },
        { header: 'subsection', example: '4C24', note: 'Unique together with program code + year + section.' },
      ],
    });
  }

  /** `POST /batches/bulk-import` (ADMIN). Resolves `program_code` -> `program_id` per row. */
  async bulkImport(buffer: Buffer, actor: AuthenticatedUser): Promise<ImportJob> {
    const records = await parseExcelBuffer(buffer, ['program_code', 'year', 'section', 'subsection']);

    const results: ImportRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2;
      const record = records[i];
      try {
        const program = await this.programsService.findByCode(record.program_code);
        if (!program) {
          throw new BadRequestException(`Program code '${record.program_code}' not found`);
        }

        const existingBatch = await this.findByProgramYearSectionSubsection(
          program.id,
          record.year,
          record.section,
          record.subsection,
        );
        if (existingBatch) {
          throw new ConflictException(
            `Batch already exists for program '${record.program_code}', year ${record.year}, section '${record.section}', subsection '${record.subsection}'`,
          );
        }

        const dto: CreateBatchDto = {
          program_id: program.id,
          year: record.year,
          section: record.section,
          subsection: record.subsection,
        };
        const batch = await this.create(dto, actor);
        results.push({ row: rowNumber, status: 'SUCCESS', id: batch.id });
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
      resourceType: 'batches',
      totalRows: records.length,
      successCount,
      failureCount,
      results,
      createdByUserId: actor.id,
    });
  }
}
