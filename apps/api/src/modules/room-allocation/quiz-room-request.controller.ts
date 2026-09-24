import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RoomAllocationService } from './room-allocation.service';
import { RoomSuggestionService } from './room-suggestion.service';
import { RequestRoomsDto } from './dto/request-rooms.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Quiz-stage room suggestion + request — this feature's own extension so
 * a faculty sees a real, capacity-accurate room/class suggestion right
 * after entering `student_count`/`preferred_date`/`preferred_time` on the
 * quiz (before any exam session exists), and the admin sees the same live
 * conflict/availability preview during quiz approval, not only later at
 * the exam-session stage. Separate controller (own `@Controller('quizzes')`
 * base) sharing RoomAllocationModule's services with `RoomAllocationController`.
 */
@Controller('quizzes')
export class QuizRoomRequestController {
  constructor(
    private readonly roomAllocationService: RoomAllocationService,
    private readonly roomSuggestionService: RoomSuggestionService,
  ) {}

  /** FACULTY only, ownership-gated — DRAFT/REJECTED quizzes only. */
  @Roles(ROLE.FACULTY)
  @Get(':id/rooms/suggest')
  suggest(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomSuggestionService.suggestForQuiz(id, actor);
  }

  /** FACULTY (ownership-gated, DRAFT/REJECTED) or ADMIN (unscoped, additionally while SUBMITTED — swapping an unavailable room during review) — saves the chosen room set + optional backup room onto the quiz. */
  @Roles(ROLE.FACULTY, ROLE.ADMIN)
  @Post(':id/rooms/request')
  request(
    @Param('id') id: string,
    @Body() dto: RequestRoomsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomAllocationService.requestForQuiz(id, dto, actor);
  }

  /** ADMIN unscoped, FACULTY owner — live availability of the quiz's requested + backup room, shown on the approval queue. */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id/rooms/conflicts')
  conflicts(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomAllocationService.getQuizRoomConflicts(id, actor);
  }
}
