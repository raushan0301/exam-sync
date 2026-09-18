import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';

/**
 * AcademicStructureModule — Phase 2 (replaces the Phase 0 empty skeleton).
 *
 * Owns Department, Program, Batch, Subject (ARCHITECTURE.md §AW's own
 * comment: "academic-structure/ # dept, program, batch, subject" — there is
 * no separate `subjects` module in the project structure, so Subject lives
 * here, not split out).
 *
 * All four services are exported so later phases (5: faculty-subject-batch
 * assignment / enrollment; 6: quiz, which references subject+batch) can
 * inject them — most importantly their `assertActiveOrThrow` guards
 * (BUSINESS_RULES.md BR-003) — without reaching into this module's
 * internals (module-boundary rule, ADR-001): importing
 * AcademicStructureModule and injecting the exported service is the
 * sanctioned cross-module path.
 */
@Module({
  controllers: [
    DepartmentsController,
    ProgramsController,
    BatchesController,
    SubjectsController,
  ],
  providers: [DepartmentsService, ProgramsService, BatchesService, SubjectsService],
  exports: [DepartmentsService, ProgramsService, BatchesService, SubjectsService],
})
export class AcademicStructureModule {}
