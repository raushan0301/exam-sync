import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { SuspensionRequestStatus } from '@exam-sync/db';
import { ExamSessionSuspensionService } from './exam-session-suspension.service';
import { RequestSuspensionDto } from './dto/request-suspension.dto';
import { ApproveSuspensionDto, RejectSuspensionDto } from './dto/review-suspension.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Suspension requests: FACULTY file them (owner/co-instructor of the session,
 * checked in the service), ADMIN review them. `GET` is role-scoped in the
 * service — admins see every request, faculty only their own.
 */
@Controller()
export class ExamSessionSuspensionController {
  constructor(private readonly suspensionService: ExamSessionSuspensionService) {}

  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/suspension-request')
  @HttpCode(HttpStatus.CREATED)
  request(@Param('id') id: string, @Body() dto: RequestSuspensionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.suspensionService.request(id, dto, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('suspension-requests')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('status') status?: SuspensionRequestStatus,
    @Query('exam_session_id') examSessionId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.suspensionService.list(actor, {
      status: status && Object.values(SuspensionRequestStatus).includes(status) ? status : undefined,
      examSessionId,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Roles(ROLE.ADMIN)
  @Post('suspension-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @Body() dto: ApproveSuspensionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.suspensionService.approve(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post('suspension-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string, @Body() dto: RejectSuspensionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.suspensionService.reject(id, dto, actor);
  }
}
