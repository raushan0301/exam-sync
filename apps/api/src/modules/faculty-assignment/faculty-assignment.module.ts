import { Module } from '@nestjs/common';
import { FacultyAssignmentsController } from './faculty-assignments.controller';
import { FacultyAssignmentsService } from './faculty-assignments.service';
import { FacultyModule } from '../faculty';
import { AcademicStructureModule } from '../academic-structure';

/**
 * FacultyAssignmentModule — Phase 5 (replaces the Phase 0 empty skeleton).
 * Owns `faculty_subject_batch_assignment`. Imports FacultyModule (faculty
 * FK validation + the self-or-ADMIN scoped lookup reused for the
 * assignments-list endpoint) and AcademicStructureModule (subject/batch FK
 * validation) — both sanctioned barrel imports.
 */
@Module({
  imports: [FacultyModule, AcademicStructureModule],
  controllers: [FacultyAssignmentsController],
  providers: [FacultyAssignmentsService],
  exports: [FacultyAssignmentsService],
})
export class FacultyAssignmentModule {}
