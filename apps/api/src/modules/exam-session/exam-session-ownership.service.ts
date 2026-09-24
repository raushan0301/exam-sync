import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/auth.types';
import { QuizOwnershipService } from '../quiz';

/**
 * Session-level extension of `QuizOwnershipService`'s owner-or-co-instructor
 * rule (see that service's own header comment for the underlying quiz-level
 * definition). A faculty member is treated as owning/co-instructing an
 * `ExamSession` iff they own-or-co-instruct AT LEAST ONE of its currently
 * ACTIVELY-attached quizzes (`ExamSessionQuiz` where `isActiveAttachment =
 * true`). This is the gate for every faculty-driven exam-session lifecycle
 * write (quiz attach/detach beyond the first, reschedule, cancel,
 * assign-students, roster add/remove, room allocation, seating
 * generate/finalize, invigilator assignment) — introduced when the
 * lifecycle was flipped from admin-only to faculty-driven.
 *
 * Deliberately narrower than `ExamSessionsAccessRepository`'s own
 * `isOwnedByActor` (which only checks `createdByFacultyId` directly on the
 * quiz, not co-instructor assignments) — that repository predates this
 * service and backs the read-only `GET /exam-sessions/{id}` scoping only;
 * this service is the one new call sites should use for anything ownership
 * related going forward, including a stricter co-instructor-aware read
 * path if one is ever needed.
 */
@Injectable()
export class ExamSessionOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quizOwnershipService: QuizOwnershipService,
  ) {}

  /**
   * True iff `actor` owns or co-instructs at least one currently
   * actively-attached quiz on this exam session. Returns `false` (never
   * throws) for a session id that doesn't exist or that currently has zero
   * active quiz attachments — callers combine this with their own
   * existence check to decide 404 vs. some other response.
   */
  async isOwnerOrCoInstructor(examSessionId: string, actor: AuthenticatedUser): Promise<boolean> {
    // The faculty who created this session can always manage it — mirrors
    // ExamSessionsAccessRepository's own `createdByAdminId` check (see its
    // comment for why). Without this, a session whose first quiz-attach
    // attempt failed (e.g. BR-019 student overlap) becomes permanently
    // un-rescheduable/un-cancelable by the one person who needs to fix it:
    // zero active attachments means the attachment-based check below can
    // never find them, an unrelated-looking 404 with no way out.
    const session = await this.prisma.examSession.findUnique({
      where: { id: examSessionId },
      select: { createdByAdminId: true },
    });
    if (session?.createdByAdminId === actor.id) {
      return true;
    }

    const attachments = await this.prisma.examSessionQuiz.findMany({
      where: { examSessionId, isActiveAttachment: true },
      include: { quiz: true },
    });

    for (const attachment of attachments) {
      if (await this.quizOwnershipService.isOwnerOrCoInstructor(attachment.quiz, actor)) {
        return true;
      }
    }
    return false;
  }
}
