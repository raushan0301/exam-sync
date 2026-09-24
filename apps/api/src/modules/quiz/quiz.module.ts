import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { QuizOwnershipService } from './quiz-ownership.service';
import { QuizAccessRepository } from './quiz-access.repository';
import { QuizApprovalHistoryService } from './quiz-approval-history.service';
import { AcademicStructureModule } from '../academic-structure';
import { FacultyModule } from '../faculty';
import { FacultyAssignmentModule } from '../faculty-assignment';
import { EnrollmentModule } from '../enrollment';

/**
 * QuizModule — Phase 6 (replaces the Phase 0 empty skeleton), extended in
 * Phase 7 with the approval workflow + `quiz_approval_history` ledger
 * (QuizApprovalHistoryService — kept in this same module since it's the
 * same domain aggregate, not a separate cross-module concern). Imports
 * AcademicStructureModule (subject/batch FK validation), FacultyModule
 * (creator/actor resolution), and FacultyAssignmentModule (BR-010
 * authorization) — all sanctioned barrel imports; none of the three import
 * QuizModule back, so no cycle.
 */
@Module({
  imports: [AcademicStructureModule, FacultyModule, FacultyAssignmentModule, EnrollmentModule],
  controllers: [QuizzesController],
  providers: [
    QuizzesService,
    QuizOwnershipService,
    QuizAccessRepository,
    QuizApprovalHistoryService,
  ],
  // QuizOwnershipService is exported alongside QuizzesService because
  // ExamSessionModule needs it directly (ExamSessionsService injects it to
  // check "does this faculty own/co-instruct the quiz being attached" —
  // the faculty-lifecycle-ownership change), not just through QuizzesService.
  exports: [QuizzesService, QuizOwnershipService],
})
export class QuizModule {}
