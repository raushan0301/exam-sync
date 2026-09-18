import { Module } from '@nestjs/common';
import { InvigilationController } from './invigilation.controller';
import { InvigilationService } from './invigilation.service';
import { ExamSessionModule } from '../exam-session';
import { FacultyModule } from '../faculty';
import { ConflictEngineModule } from '../conflict-engine';

/**
 * InvigilationModule — Phase 16 (replaces the Phase 0 empty skeleton).
 * Owns `exam_invigilators`. Imports ExamSessionModule (session
 * lookup/CANCELLED guard), FacultyModule (faculty existence + self-lookup
 * for the duties endpoint), and ConflictEngineModule
 * (`checkInvigilatorAssignment` — BR-020/BR-031).
 */
@Module({
  imports: [ExamSessionModule, FacultyModule, ConflictEngineModule],
  controllers: [InvigilationController],
  providers: [InvigilationService],
  exports: [InvigilationService],
})
export class InvigilationModule {}
