import { Injectable } from '@nestjs/common';
import { Faculty } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopedRepository } from '../../common/authorization/scoped-repository';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Resource-level authorization for `GET /faculty/{id}` — mirrors
 * StudentsAccessRepository (Phase 3) exactly. This specific endpoint isn't
 * in API_CONTRACT.md's literal table (only `POST /faculty` and
 * `GET /faculty/{id}/assignments` are), but IMPLEMENTATION_PLAN.md Phase 4
 * says "mirrors Phase 3 patterns for faculty" — self-or-ADMIN scoping is
 * exactly such a pattern, so it's extended here the same disclosed way.
 */
@Injectable()
export class FacultyAccessRepository extends ScopedRepository<Faculty> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  protected async findByIdUnscoped(id: string): Promise<Faculty | null> {
    return this.prisma.faculty.findUnique({ where: { id } });
  }

  protected isOwnedByActor(entity: Faculty, actor: AuthenticatedUser): boolean {
    return entity.userId === actor.id;
  }

  protected isAdminBypass(actor: AuthenticatedUser): boolean {
    return actor.roles.includes(ROLE.ADMIN);
  }
}
