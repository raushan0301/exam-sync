import { Module } from '@nestjs/common';
import { StudentAssignmentController } from './student-assignment.controller';
import { StudentAssignmentService } from './student-assignment.service';
import { ExamSessionModule } from '../exam-session';
import { ConflictEngineModule } from '../conflict-engine';
import { QuizModule } from '../quiz';
import { StudentsModule } from '../students';
import { EnrollmentModule } from '../enrollment';

/**
 * StudentAssignmentModule — Phase 9 established this module; Phase 10
 * adds `ConflictEngineModule` so the real BR-019 check can run at
 * assignment-creation time (see student-assignment.service.ts's header
 * comment for why that's a second, necessary enforcement point beyond
 * exam-session attach/reschedule). Also imports ExamSessionModule
 * (session lookup/scoping — reuses `ExamSessionsService.findByIdScoped`,
 * the same ADMIN-or-owning-FACULTY rule Phase 8 established), QuizModule
 * (subject_id + batch attachment lookup per quiz), StudentsModule
 * (student existence), and EnrollmentModule (`findEligibleStudentIds` —
 * BR-005 eligibility). `ImportJobsService`/`AuditHookService` are
 * `@Global()` and need no explicit import.
 */
@Module({
  imports: [ExamSessionModule, ConflictEngineModule, QuizModule, StudentsModule, EnrollmentModule],
  controllers: [StudentAssignmentController],
  providers: [StudentAssignmentService],
  exports: [StudentAssignmentService],
})
export class StudentAssignmentModule {}
