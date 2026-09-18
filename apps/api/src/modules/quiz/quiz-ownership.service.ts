import { Injectable } from '@nestjs/common';
import { Quiz } from '@exam-sync/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FacultyService } from '../faculty';
import { FacultyAssignmentsService } from '../faculty-assignment';
import { AuthenticatedUser } from '../../common/auth/auth.types';

/**
 * ARCHITECTURE.md §AF: "Faculty can only GET/PATCH a quiz where
 * quiz.created_by_faculty_id = current_faculty.id OR they hold a
 * CO_INSTRUCTOR assignment on it." One shared implementation, used by both
 * QuizzesAccessRepository (GET, with ADMIN bypass) and the stricter
 * PATCH/submit paths (no ADMIN bypass — see quizzes.service.ts's own
 * comment on why those two endpoints have genuinely different policies,
 * not just different HTTP verbs on the same rule).
 */
@Injectable()
export class QuizOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyService: FacultyService,
    private readonly facultyAssignmentsService: FacultyAssignmentsService,
  ) {}

  async isOwnerOrCoInstructor(quiz: Quiz, actor: AuthenticatedUser): Promise<boolean> {
    const actingFaculty = await this.facultyService.findByUserId(actor.id);
    if (!actingFaculty) {
      return false; // Not a faculty account at all — cannot own or co-instruct anything.
    }
    if (quiz.createdByFacultyId === actingFaculty.id) {
      return true;
    }

    const batchIds = await this.prisma.quizBatch
      .findMany({ where: { quizId: quiz.id }, select: { batchId: true } })
      .then((rows) => rows.map((r) => r.batchId));

    return this.facultyAssignmentsService.hasActiveCoInstructorAssignment(
      actingFaculty.id,
      quiz.subjectId,
      batchIds,
    );
  }
}
