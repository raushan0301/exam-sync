import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Department, AcademicStatus } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditHookService } from '../../common/audit/audit-hook.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import {
  cursorFindManyArgs,
  PaginatedResult,
  resolveLimit,
  toPaginatedResult,
} from '../../common/pagination/paginate';
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
}
