import { Injectable } from '@nestjs/common';
import { ExamSession } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopedRepository } from '../../common/authorization/scoped-repository';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';
import { FacultyService } from '../faculty';

/**
 * Resource-level authorization for `GET /exam-sessions/{id}`
 * (API_CONTRACT.md: Auth "scoped" — not further specified there, so this
 * mirrors the ownership-based scoping pattern used throughout this
 * codebase: ADMIN sees any session; FACULTY sees a session iff they
 * created at least one of its currently ACTIVELY-attached quizzes.
 * Deliberately narrower than Quiz's own owner-or-co-instructor rule (kept
 * simple, disclosed) — co-instructor visibility into the *session* level
 * isn't specified anywhere and would be scope creep to invent here.
 * STUDENT has no access at all in Phase 8 (no student-facing schedule
 * exists yet — that's a much later phase once seating/assignment exist).
 */
@Injectable()
export class ExamSessionsAccessRepository extends ScopedRepository<ExamSession> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyService: FacultyService,
  ) {
    super();
  }

  protected async findByIdUnscoped(id: string): Promise<ExamSession | null> {
    return this.prisma.examSession.findUnique({ where: { id } });
  }

  protected async isOwnedByActor(entity: ExamSession, actor: AuthenticatedUser): Promise<boolean> {
    const actingFaculty = await this.facultyService.findByUserId(actor.id);
    if (!actingFaculty) {
      return false;
    }
    const count = await this.prisma.examSessionQuiz.count({
      where: {
        examSessionId: entity.id,
        isActiveAttachment: true,
        quiz: { createdByFacultyId: actingFaculty.id },
      },
    });
    return count > 0;
  }

  protected isAdminBypass(actor: AuthenticatedUser): boolean {
    return actor.roles.includes(ROLE.ADMIN);
  }
}
