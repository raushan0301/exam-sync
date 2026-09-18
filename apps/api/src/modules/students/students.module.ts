import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentsAccessRepository } from './students-access.repository';
import { AcademicStructureModule } from '../academic-structure';
import { AuthModule } from '../auth';
import { FacultyAssignmentModule } from '../faculty-assignment';

/**
 * StudentsModule — Phase 3 (replaces the Phase 0 empty skeleton); extended
 * in Phase 5 to import FacultyAssignmentModule so StudentsAccessRepository
 * can resolve the "FACULTY (if teaches them)" branch of
 * `GET /students/{id}`'s resource-level authorization, fulfilling the
 * TODO explicitly left there in Phase 3.
 *
 * No circular dependency: FacultyAssignmentModule depends on FacultyModule
 * and AcademicStructureModule only, never on StudentsModule.
 */
@Module({
  imports: [AcademicStructureModule, AuthModule, FacultyAssignmentModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentsAccessRepository],
  exports: [StudentsService],
})
export class StudentsModule {}
