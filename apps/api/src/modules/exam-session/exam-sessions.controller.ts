import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ExamSessionsService } from './exam-sessions.service';
import { CreateExamSessionDto } from './dto/create-exam-session.dto';
import { RescheduleExamSessionDto } from './dto/reschedule-exam-session.dto';
import { UpdateSessionQuizzesDto } from './dto/update-session-quizzes.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Exam Sessions" — the Phase 8 subset (create,
 * quiz attach/detach, reschedule, cancel, GET one, GET conflicts), later
 * flipped from admin-authored to faculty-driven (see
 * ExamSessionOwnershipService's header comment): FACULTY now exclusively
 * drives every mutating action here for sessions built from their own
 * quizzes; ADMIN keeps full read-only visibility (`GET :id`, `GET
 * :id/conflicts`) across every session, unscoped. `assign-students`,
 * `roster`, `rooms/allocate`, `seating/*`, `invigilators` etc. from that
 * same doc section live in later-phase modules and got the identical
 * ADMIN->FACULTY + ownership-gating treatment there.
 */
@Controller('exam-sessions')
export class ExamSessionsController {
  constructor(private readonly examSessionsService: ExamSessionsService) {}

  /**
   * FACULTY only (ADMIN lost write access to the lifecycle entirely). No
   * `quiz_id` is required at creation — see `create()`'s own comment on
   * why a bare, momentarily-unowned DRAFT is the smaller, contract-
   * compatible choice; the FIRST quiz attach (`PATCH :id/quizzes`) is
   * where ownership actually gets enforced.
   */
  @Roles(ROLE.FACULTY)
  @Post()
  create(@Body() dto: CreateExamSessionDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.examSessionsService.create(dto, actor);
  }

  /** "scoped" per API_CONTRACT.md — resolved inside the service (ADMIN sees any session, unscoped; FACULTY sees a session iff they own/co-instruct an attached quiz). */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.examSessionsService.getDetail(id, actor);
  }

  /**
   * `GET /exam-sessions` — added for the faculty "My Exam Sessions" list
   * and the new admin read-only "all scheduled sessions" dashboard; not
   * part of the original API_CONTRACT.md Phase 8 subset. ADMIN sees every
   * session, unscoped; FACULTY sees only sessions where they own/co-
   * instruct at least one actively-attached quiz.
   */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.examSessionsService.list(actor, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** FACULTY only, ownership-gated inside the service (own-or-co-instruct at least one currently active attachment, except on a brand-new session's first attach). */
  @Roles(ROLE.FACULTY)
  @Patch(':id/quizzes')
  updateQuizzes(
    @Param('id') id: string,
    @Body() dto: UpdateSessionQuizzesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.examSessionsService.attachAndDetachQuizzes(id, dto, actor);
  }

  /** FACULTY only, ownership-gated inside the service (404 if the session exists but isn't theirs — mirrors quizzes.service.ts's own PATCH convention). */
  @Roles(ROLE.FACULTY)
  @Post(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleExamSessionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.examSessionsService.reschedule(id, dto, actor);
  }

  /** Same scoping as `GET :id` (ADMIN unscoped, FACULTY owner/co-instructor only) — previously ADMIN-only with no scoping at all. */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id/conflicts')
  conflicts(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.examSessionsService.getConflicts(id, actor);
  }
}
