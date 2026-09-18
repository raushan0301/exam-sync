import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { QuizStudentAssignmentStatus } from '@exam-sync/db';
import { StudentAssignmentService } from './student-assignment.service';
import { AddRosterEntryDto } from './dto/add-roster-entry.dto';
import { RemoveRosterEntryDto } from './dto/remove-roster-entry.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Student Assignment" — Phase 9's
 * `assign-students` and `roster` endpoints, nested under the same
 * `/exam-sessions` path Phase 8's `ExamSessionsController` owns (a
 * separate controller/module, since this domain owns its own table —
 * Nest allows multiple controllers to share a path prefix).
 */
@Controller('exam-sessions')
export class StudentAssignmentController {
  constructor(private readonly studentAssignmentService: StudentAssignmentService) {}

  /** `202 {job_id}` per API_CONTRACT.md — see this service's own header comment on why generation is synchronous-but-chunked rather than a real queued job in Phase 9. */
  @Roles(ROLE.ADMIN)
  @Post(':id/assign-students')
  @HttpCode(202)
  async assignStudents(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    const { importJob, examSession } = await this.studentAssignmentService.assignStudents(id, actor);
    return {
      job_id: importJob.id,
      status: importJob.status,
      total_rows: importJob.totalRows,
      success_count: importJob.successCount,
      failure_count: importJob.failureCount,
      exam_session: examSession,
    };
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id/roster')
  roster(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: QuizStudentAssignmentStatus,
  ) {
    return this.studentAssignmentService.getRoster(id, actor, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
    });
  }

  @Roles(ROLE.ADMIN)
  @Post(':id/roster/:studentId')
  addRosterEntry(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body() dto: AddRosterEntryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.studentAssignmentService.addRosterEntry(id, studentId, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Delete(':id/roster/:studentId')
  removeRosterEntry(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body() dto: RemoveRosterEntryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.studentAssignmentService.removeRosterEntry(id, studentId, dto, actor);
  }
}
