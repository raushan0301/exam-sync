import { Module } from '@nestjs/common';
import { ExamSessionsController } from './exam-sessions.controller';
import { ExamSessionsService } from './exam-sessions.service';
import { ExamSessionsAccessRepository } from './exam-sessions-access.repository';
import { ExamSessionOwnershipService } from './exam-session-ownership.service';
import { ConflictEngineModule } from '../conflict-engine';
import { FacultyModule } from '../faculty';
import { QuizModule } from '../quiz';

/**
 * ExamSessionModule — Phase 8 (replaces the Phase 0 empty skeleton). Owns
 * `exam_sessions` + `exam_session_quizzes`. Imports ConflictEngineModule
 * (the Phase 8 STUB — see that module's header comment), FacultyModule
 * (resource-level "does this faculty own an attached quiz" scoping), and
 * QuizModule (validating/fetching quizzes being attached, through
 * QuizzesService rather than reaching into the quizzes table directly —
 * the same sanctioned cross-module pattern used everywhere else).
 */
@Module({
  imports: [ConflictEngineModule, FacultyModule, QuizModule],
  controllers: [ExamSessionsController],
  providers: [ExamSessionsService, ExamSessionsAccessRepository, ExamSessionOwnershipService],
  exports: [ExamSessionsService, ExamSessionOwnershipService],
})
export class ExamSessionModule {}
