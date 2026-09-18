import { Module } from '@nestjs/common';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { StudentsModule } from '../students';
import { AcademicStructureModule } from '../academic-structure';
import { FacultyAssignmentModule } from '../faculty-assignment';

/**
 * EnrollmentModule — Phase 5 (replaces the Phase 0 empty skeleton).
 * Owns `student_subject_enrollment`. Imports StudentsModule (student FK
 * validation + batch lookup), AcademicStructureModule (subject/batch FK
 * validation), and FacultyAssignmentModule (teaching-faculty check) — all
 * sanctioned barrel imports. No circular dependency: none of these three
 * import EnrollmentModule back.
 */
@Module({
  imports: [StudentsModule, AcademicStructureModule, FacultyAssignmentModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentModule {}
