import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportWorkerService } from './report-worker.service';
import { ExamSessionModule } from '../exam-session';

/**
 * ReportingModule — Phase 19 (replaces the Phase 0 empty skeleton). Owns
 * `report_jobs`. Imports ExamSessionModule (session existence check —
 * every report type is scoped to one `exam_session_id`).
 * `NotificationsOutboxModule`/`QueueModule` are global (mirrors every
 * other module's own note) and need no import here.
 */
@Module({
  imports: [ExamSessionModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportWorkerService],
})
export class ReportingModule {}
