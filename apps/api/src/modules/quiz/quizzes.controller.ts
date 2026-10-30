import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { QuizStatus } from '@exam-sync/db';
import { QuizzesService } from './quizzes.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { RejectQuizDto } from './dto/reject-quiz.dto';
import { ApproveQuizDto } from './dto/approve-quiz.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Quiz" — Phase 6 (`POST /quizzes`,
 * `PATCH /quizzes/{id}`, `POST /quizzes/{id}/submit`, `GET /quizzes`,
 * `GET /quizzes/{id}` — the last one a disclosed extrapolation) plus
 * Phase 7's `POST /quizzes/{id}/approve`, `POST /quizzes/{id}/reject`,
 * `GET /quizzes/{id}/approval-history`.
 */
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Roles(ROLE.FACULTY)
  @Post()
  create(@Body() dto: CreateQuizDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.quizzesService.create(dto, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: QuizStatus,
    @Query('subject_id') subjectId?: string,
    @Query('faculty_id') facultyId?: string,
  ) {
    return this.quizzesService.list(
      { cursor, limit: limit ? parseInt(limit, 10) : undefined, status, subjectId, facultyId },
      actor,
    );
  }

  /**
   * `GET /quizzes/eligible-student-count` — this feature's own addition,
   * so the quiz-creation form can auto-fill `student_count` from real
   * enrollment as soon as subject/batches/academic_year/semester are
   * picked (before the quiz exists) — registered BEFORE `:id` below so
   * Nest doesn't treat "eligible-student-count" as a quiz id.
   */
  @Roles(ROLE.FACULTY)
  @Get('eligible-student-count')
  eligibleStudentCount(
    @Query('subject_id') subjectId?: string,
    @Query('batch_ids') batchIds?: string,
    @Query('academic_year') academicYear?: string,
    @Query('semester') semester?: string,
  ) {
    if (!subjectId || !batchIds || !academicYear || !semester) {
      throw new BadRequestException('subject_id, batch_ids, academic_year, and semester are all required.');
    }
    return this.quizzesService.getEligibleStudentCount(
      subjectId,
      batchIds.split(',').filter(Boolean),
      academicYear,
      parseInt(semester, 10),
    );
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quizzesService.findByIdScoped(id, actor);
  }

  @Roles(ROLE.FACULTY)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQuizDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (ifMatch === undefined || ifMatch === '' || Number.isNaN(Number(ifMatch))) {
      throw new BadRequestException('An "If-Match" header carrying the current version is required.');
    }
    return this.quizzesService.update(id, dto, Number(ifMatch), actor);
  }

  @Roles(ROLE.FACULTY)
  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quizzesService.submit(id, actor);
  }

  /**
   * Uses the same `If-Match` convention as PATCH (EC-047's "the approve
   * action must include the version the admin was viewing" — the
   * contract's Request column says "—" i.e. no body, so the version
   * travels as a header, consistent with how PATCH already does it).
   */
  @Roles(ROLE.ADMIN)
  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ApproveQuizDto = {},
  ) {
    if (ifMatch === undefined || ifMatch === '' || Number.isNaN(Number(ifMatch))) {
      throw new BadRequestException('An "If-Match" header carrying the current version is required.');
    }
    return this.quizzesService.approve(id, Number(ifMatch), actor, dto?.room_note);
  }

  @Roles(ROLE.ADMIN)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectQuizDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.quizzesService.reject(id, dto, actor);
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id/approval-history')
  approvalHistory(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.quizzesService.getApprovalHistory(id, actor);
  }
}
