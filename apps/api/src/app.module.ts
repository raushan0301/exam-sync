import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module';
import { RequestContextMiddleware } from './common/observability/request-context.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuditHookModule } from './common/audit/audit-hook.module';
import { ImportJobsModule } from './common/import-jobs/import-jobs.module';
import { NotificationsOutboxModule } from './common/notifications-outbox/notifications-outbox.module';
import { RoomHoldsModule } from './common/room-holds/room-holds.module';
import { QueueModule } from './common/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AcademicStructureModule } from './modules/academic-structure/academic-structure.module';
import { StudentsModule } from './modules/students/students.module';
import { FacultyModule } from './modules/faculty/faculty.module';
import { EnrollmentModule } from './modules/enrollment/enrollment.module';
import { FacultyAssignmentModule } from './modules/faculty-assignment/faculty-assignment.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { ExamSessionModule } from './modules/exam-session/exam-session.module';
import { StudentAssignmentModule } from './modules/student-assignment/student-assignment.module';
import { ConflictEngineModule } from './modules/conflict-engine/conflict-engine.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { RoomAllocationModule } from './modules/room-allocation/room-allocation.module';
import { SeatingEngineModule } from './modules/seating-engine/seating-engine.module';
import { InvigilationModule } from './modules/invigilation/invigilation.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdministrationModule } from './modules/administration/administration.module';

/**
 * Root application module — Phase 0.
 *
 * Every domain module from ARCHITECTURE.md §AW is registered here as an
 * empty skeleton (see each module's own file for the Phase-0-only notice).
 * Only HealthModule exposes a real route in Phase 0
 * (IMPLEMENTATION_PLAN.md Phase 0 "APIs: health-check endpoint only").
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuditHookModule,
    ImportJobsModule,
    NotificationsOutboxModule,
    RoomHoldsModule,
    QueueModule,
    HealthModule,
    AuthModule,
    AcademicStructureModule,
    StudentsModule,
    FacultyModule,
    EnrollmentModule,
    FacultyAssignmentModule,
    QuizModule,
    ApprovalModule,
    ExamSessionModule,
    StudentAssignmentModule,
    ConflictEngineModule,
    RoomsModule,
    RoomAllocationModule,
    SeatingEngineModule,
    InvigilationModule,
    AttendanceModule,
    IncidentsModule,
    NotificationsModule,
    ReportingModule,
    AuditModule,
    AdministrationModule,
  ],
})
export class AppModule implements NestModule {
  // Phase 20 (ARCHITECTURE.md §AJ/§AP) — applied first, ahead of every
  // request, so `AuditHookService.record()` can read the correlation ID
  // via AsyncLocalStorage for any mutating call anywhere downstream.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
