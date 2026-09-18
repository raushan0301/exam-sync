import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ExamSessionLifecycleService } from './exam-session-lifecycle.service';
import { ExamSessionModule } from '../exam-session';
import { FacultyModule } from '../faculty';
import { StudentsModule } from '../students';

/**
 * AttendanceModule — Phase 17 (replaces the Phase 0 empty skeleton). Owns
 * `attendance` + `attendance_history`. Imports ExamSessionModule (session
 * lookup/status guards, and `ExamSessionLifecycleService`'s disclosed
 * start/complete plumbing), FacultyModule (invigilator-of-record
 * resolution), StudentsModule (`GET /students/{id}/attendance-history`
 * self-scoping).
 */
@Module({
  imports: [ExamSessionModule, FacultyModule, StudentsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, ExamSessionLifecycleService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
