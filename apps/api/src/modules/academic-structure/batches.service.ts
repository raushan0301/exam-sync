import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Batch, AcademicStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
import { ProgramsService } from './programs.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';

export interface ListBatchesParams {
  cursor?: string;
  limit?: number;
  status?: AcademicStatus;
  programId?: string;
  year?: number;
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly programsService: ProgramsService,
  ) {}

  async create(dto: CreateBatchDto, actor: AuthenticatedUser): Promise<Batch> {
    // Confirms the program exists — Batch belongs to exactly one Program.
    await this.programsService.findById(dto.program_id);

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.batch
        .create({
          data: { programId: dto.program_id, year: dto.year, section: dto.section },
        })
        .catch((err) => this.mapUniqueViolation(err, dto));

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

    if (dto.program_id) {
      await this.programsService.findById(dto.program_id);
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.batch
        .update({
          where: { id },
          data: {
            programId: dto.program_id,
            year: dto.year,
            section: dto.section,
            status: dto.status,
          },
        })
        .catch((err) =>
          this.mapUniqueViolation(err, { program_id: dto.program_id, year: dto.year, section: dto.section }),
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
    ident: { program_id?: string; year?: number; section?: string },
  ): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        `A batch for program "${ident.program_id}", year ${ident.year}, section "${ident.section}" already exists.`,
      );
    }
    throw err;
  }
}
