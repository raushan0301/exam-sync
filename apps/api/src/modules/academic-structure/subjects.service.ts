import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Subject } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
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
  ) {}

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
}
