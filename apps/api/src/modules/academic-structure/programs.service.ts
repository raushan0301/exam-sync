import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Program, AcademicStatus } from '@exam-sync/db';
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
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';

export interface ListProgramsParams {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: AcademicStatus;
  departmentId?: string;
}

@Injectable()
export class ProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditHook: AuditHookService,
    private readonly departmentsService: DepartmentsService,
  ) {}

  async create(dto: CreateProgramDto, actor: AuthenticatedUser): Promise<Program> {
    // Confirms the department exists (API_CONTRACT.md: "404 bad dept") —
    // a Program belongs to exactly one Department (BR-002), so the FK
    // target must be validated before insert, not left to a raw FK error.
    await this.departmentsService.findById(dto.department_id);

    const program = await this.prisma.$transaction(async (tx) => {
      const created = await tx.program
        .create({
          data: { departmentId: dto.department_id, name: dto.name, code: dto.code },
        })
        .catch((err) => this.mapUniqueViolation(err, dto.code));

      await this.auditHook.record(
        {
          actor,
          action: 'CREATE',
          entityType: 'Program',
          entityId: created.id,
          newValue: created,
        },
        tx,
      );

      return created;
    });

    return program;
  }

  async findById(id: string): Promise<Program> {
    const program = await this.prisma.program.findUnique({ where: { id } });
    if (!program) {
      throw new NotFoundException();
    }
    return program;
  }

  async list(params: ListProgramsParams): Promise<PaginatedResult<Program>> {
    const limit = resolveLimit(params.limit);

    const rows = await this.prisma.program.findMany({
      ...cursorFindManyArgs(params.cursor, limit),
      where: {
        status: params.status,
        departmentId: params.departmentId,
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

  async update(id: string, dto: UpdateProgramDto, actor: AuthenticatedUser): Promise<Program> {
    const existing = await this.findById(id);

    if (dto.department_id) {
      // BR-002: reassignment is allowed only via this explicit,
      // ADMIN-only, audited action (never implicit/cascading).
      await this.departmentsService.findById(dto.department_id);
    }

    const program = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.program
        .update({
          where: { id },
          data: {
            departmentId: dto.department_id,
            name: dto.name,
            code: dto.code,
            status: dto.status,
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
          entityType: 'Program',
          entityId: updated.id,
          oldValue: existing,
          newValue: updated,
        },
        tx,
      );

      return updated;
    });

    return program;
  }

  /** See DepartmentsService.assertActiveOrThrow — same seam, for programs. */
  async assertActiveOrThrow(id: string): Promise<Program> {
    const program = await this.findById(id);
    if (program.status !== AcademicStatus.ACTIVE) {
      throw new ConflictException(
        `Program "${program.code}" is not active and cannot be referenced by new records.`,
      );
    }
    return program;
  }

  private mapUniqueViolation(err: unknown, code: string | undefined): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(`Program code "${code}" already exists.`);
    }
    throw err;
  }
}
