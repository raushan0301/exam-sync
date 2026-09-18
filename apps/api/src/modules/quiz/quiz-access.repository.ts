import { Injectable } from '@nestjs/common';
import { Quiz } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopedRepository } from '../../common/authorization/scoped-repository';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { QuizOwnershipService } from './quiz-ownership.service';

/**
 * Resource-level authorization for `GET /quizzes/{id}` (extrapolated the
 * same disclosed way as every prior phase's single-entity GET — see this
 * phase's pre-implementation notes). ADMIN sees any quiz; FACULTY sees
 * only quizzes they own or co-instruct (BUSINESS_RULES.md BR-046) — a
 * 404, not 403, for anything else, hiding whether the quiz id exists at
 * all (same IDOR-safe convention as every other ScopedRepository in this
 * codebase).
 */
@Injectable()
export class QuizAccessRepository extends ScopedRepository<Quiz> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: QuizOwnershipService,
  ) {
    super();
  }

  protected async findByIdUnscoped(id: string): Promise<Quiz | null> {
    return this.prisma.quiz.findUnique({ where: { id } });
  }

  protected isOwnedByActor(entity: Quiz, actor: AuthenticatedUser): Promise<boolean> {
    return this.ownershipService.isOwnerOrCoInstructor(entity, actor);
  }

  protected isAdminBypass(actor: AuthenticatedUser): boolean {
    return actor.roles.includes(ROLE.ADMIN);
  }
}
