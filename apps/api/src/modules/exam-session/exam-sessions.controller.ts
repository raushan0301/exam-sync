import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ExamSessionsService } from './exam-sessions.service';
import { CreateExamSessionDto } from './dto/create-exam-session.dto';
import { RescheduleExamSessionDto } from './dto/reschedule-exam-session.dto';
import { CancelExamSessionDto } from './dto/cancel-exam-session.dto';
import { UpdateSessionQuizzesDto } from './dto/update-session-quizzes.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Exam Sessions" — the Phase 8 subset (create,
 * quiz attach/detach, reschedule, cancel, GET one, GET conflicts).
 * `assign-students`, `roster`, `rooms/allocate`, `seating/*`,
 * `invigilators` etc. from that same doc section belong to later phases
 * (9, 11-14, 16) and are explicitly NOT here.
 */
@Controller('exam-sessions')
export class ExamSessionsController {
  constructor(private readonly examSessionsService: ExamSessionsService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateExamSessionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.examSessionsService.create(dto, actor);
  }

  /** "scoped" per API_CONTRACT.md — resolved inside the service (ADMIN or a faculty who owns an attached quiz). */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.examSessionsService.getDetail(id, actor);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id/quizzes')
  updateQuizzes(
    @Param('id') id: string,
    @Body() dto: UpdateSessionQuizzesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.examSessionsService.attachAndDetachQuizzes(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleExamSessionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.examSessionsService.reschedule(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelExamSessionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.examSessionsService.cancel(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Get(':id/conflicts')
  conflicts(@Param('id') id: string) {
    return this.examSessionsService.getConflicts(id);
  }
}
