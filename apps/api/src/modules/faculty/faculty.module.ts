import { Module } from '@nestjs/common';
import { FacultyController } from './faculty.controller';
import { FacultyService } from './faculty.service';
import { FacultyAccessRepository } from './faculty-access.repository';
import { AcademicStructureModule } from '../academic-structure';
import { AuthModule } from '../auth';

/**
 * FacultyModule — Phase 4 (replaces the Phase 0 empty skeleton).
 * Mirrors StudentsModule's (Phase 3) import shape exactly: AcademicStructureModule
 * for DepartmentsService, AuthModule for PasswordService.
 */
@Module({
  imports: [AcademicStructureModule, AuthModule],
  controllers: [FacultyController],
  providers: [FacultyService, FacultyAccessRepository],
  exports: [FacultyService],
})
export class FacultyModule {}
