import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ExamSessionLifecycleService } from './exam-session-lifecycle.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md "Attendance" — the 4 documented routes, plus 2 undocumented `start`/`complete` FACULTY actions, ownership-gated inside the service (see `ExamSessionLifecycleService`'s header comment for why they exist and why they're FACULTY, not ADMIN). */
@Controller()
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly lifecycleService: ExamSessionLifecycleService,
  ) {}

  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/attendance')
  mark(@Param('id') id: string, @Body() dto: MarkAttendanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.attendanceService.mark(id, dto, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Patch('attendance/:id')
  update(@Param('id') id: string, @Body() dto: UpdateAttendanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.attendanceService.update(id, dto, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('exam-sessions/:id/attendance')
  listForSession(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.attendanceService.listForSession(id, actor, { cursor, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Get('students/:id/attendance-history')
  getHistoryForStudent(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.attendanceService.getHistoryForStudent(id, actor, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/start')
  start(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.lifecycleService.start(id, actor);
  }

  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/complete')
  complete(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.lifecycleService.complete(id, actor);
  }
}
