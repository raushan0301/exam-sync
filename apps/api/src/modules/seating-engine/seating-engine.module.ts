import { Module } from '@nestjs/common';
import { SeatingEngineController } from './seating-engine.controller';
import { SeatingEngineService } from './seating-engine.service';
import { ExamSessionModule } from '../exam-session';
import { QuizModule } from '../quiz';

/**
 * SeatingEngineModule — Phase 13 (replaces the Phase 0 empty skeleton).
 * Owns `seating_plans` + `seating_assignments`. Imports ExamSessionModule
 * (session lookup/status guard, scoped-GET reuse) and QuizModule
 * (subject_id lookup per quiz, for the soft subject-adjacency
 * constraint). The actual generation/validation algorithms come from
 * `@exam-sync/domain-logic`, a plain npm dependency, not a Nest module.
 */
@Module({
  imports: [ExamSessionModule, QuizModule],
  controllers: [SeatingEngineController],
  providers: [SeatingEngineService],
  exports: [SeatingEngineService],
})
export class SeatingEngineModule {}
