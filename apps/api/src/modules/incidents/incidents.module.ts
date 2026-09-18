import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { ExamSessionModule } from '../exam-session';
import { FacultyModule } from '../faculty';
import { StudentsModule } from '../students';
import { RoomsModule } from '../rooms';
import { QuizModule } from '../quiz';

/**
 * IncidentsModule — Phase 18 (replaces the Phase 0 empty skeleton). Owns
 * `incidents` + `incident_history`. Imports ExamSessionModule (session
 * existence check), FacultyModule (invigilator-of-record resolution),
 * StudentsModule/RoomsModule/QuizModule (validating the incident's
 * optional FK targets). `NotificationsOutboxModule` and `AuditHookModule`
 * are global (mirrors every other module's own note) and need no import
 * here.
 */
@Module({
  imports: [ExamSessionModule, FacultyModule, StudentsModule, RoomsModule, QuizModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
