import { Module } from '@nestjs/common';
import { ConflictEngineService } from './conflict-engine.service';
import { QuizModule } from '../quiz';
import { EnrollmentModule } from '../enrollment';

/**
 * ConflictEngineModule — Phase 8 established this as a real module with
 * only a stub service; Phase 10 gives it real logic (see
 * conflict-engine.service.ts's header comment), which needs `QuizModule`
 * (subject/batch lookup per quiz) and `EnrollmentModule`
 * (`findEligibleStudentIds`, BR-005) to derive each quiz's eligible
 * roster for the student-overlap check.
 */
@Module({
  imports: [QuizModule, EnrollmentModule],
  providers: [ConflictEngineService],
  exports: [ConflictEngineService],
})
export class ConflictEngineModule {}
