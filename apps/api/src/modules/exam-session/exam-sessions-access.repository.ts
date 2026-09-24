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
 * created at least one of its currently ACTIVELY-attached quizzes, OR
 * they're assigned as an invigilator on it (any room) — added so the
 * FACULTY attendance-marking page
 * (`app/faculty/exam-sessions/[id]/attendance/page.tsx`) is actually
 * reachable by the invigilator physically in the room, not just the
 * session's creator; that page's own header comment previously disclosed
 * this exact gap as blocking it. Co-instructor visibility into the
 * *session* level (as opposed to invigilator) still isn't specified
 * anywhere and stays out of scope. STUDENT has no access at all in Phase
 * 8 (no student-facing schedule exists yet — that's a much later phase
 * once seating/assignment exist).
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
    // The faculty who created this session (create() stores actor.id here
    // despite the legacy `createdByAdminId` name — see that method's own
    // comment) can always see it, even before any quiz is attached, or
    // after the only attach attempt failed (e.g. a conflict) and left it
    // an orphan. Without this, a session whose first attach fails becomes
    // permanently invisible to the one person who needs to retry it.
    if (entity.createdByAdminId === actor.id) {
      return true;
    }

    const actingFaculty = await this.facultyService.findByUserId(actor.id);
    if (!actingFaculty) {
      return false;
    }
    const [quizCount, invigilatorCount] = await Promise.all([
      this.prisma.examSessionQuiz.count({
        where: {
          examSessionId: entity.id,
          isActiveAttachment: true,
          quiz: { createdByFacultyId: actingFaculty.id },
        },
      }),
      this.prisma.examInvigilator.count({
        where: { examSessionId: entity.id, facultyId: actingFaculty.id },
      }),
    ]);
    return quizCount > 0 || invigilatorCount > 0;
  }

  protected isAdminBypass(actor: AuthenticatedUser): boolean {
    return actor.roles.includes(ROLE.ADMIN);
  }
}
