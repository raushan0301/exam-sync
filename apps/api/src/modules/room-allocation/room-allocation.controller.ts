import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RoomAllocationService } from './room-allocation.service';
import { RoomSuggestionService } from './room-suggestion.service';
import { AllocateRoomsDto } from './dto/allocate-rooms.dto';
import { RequestRoomsDto, RejectRoomRequestDto } from './dto/request-rooms.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Room Allocation": `POST /exam-sessions/{id}/rooms/allocate`.
 * Restores the two-step FSM (room REQUEST by FACULTY, then ADMIN
 * APPROVAL via `allocate`/`reject`) — see `RoomAllocationService`'s own
 * header comment.
 */
@Controller('exam-sessions')
export class RoomAllocationController {
  constructor(
    private readonly roomAllocationService: RoomAllocationService,
    private readonly roomSuggestionService: RoomSuggestionService,
  ) {}

  /** FACULTY only, ownership-gated — three algorithm previews (fewest rooms / sequential / balanced spread) sized against real room capacity + live availability. */
  @Roles(ROLE.FACULTY)
  @Get(':id/rooms/suggest')
  suggest(
    @Param('id') id: string,
    @Query('empty_columns') emptyColumns: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomSuggestionService.suggest(id, actor, emptyColumns === 'true');
  }

  /** FACULTY only, ownership-gated — submits the faculty's chosen room set + optional backup room for admin review. */
  @Roles(ROLE.FACULTY)
  @Post(':id/rooms/request')
  request(
    @Param('id') id: string,
    @Body() dto: RequestRoomsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomAllocationService.request(id, dto, actor);
  }

  /** FACULTY only, ownership-gated — self-service allocation using ONLY the room(s) already approved by an admin at quiz-approval time; no separate admin review needed for this exact set. */
  @Roles(ROLE.FACULTY)
  @Post(':id/rooms/allocate-preapproved')
  allocatePreApproved(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomAllocationService.allocatePreApproved(id, actor);
  }

  /** ADMIN unscoped, FACULTY owner/co-instructor — live availability of the requested + backup room, with alternatives for anything unavailable. */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get(':id/rooms/preview')
  preview(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomAllocationService.getAvailabilityPreview(id, actor);
  }

  /** ADMIN only — the approval step. Defaults to the faculty's requested rooms; pass room_ids to swap, or auto for an algorithmic pick. */
  @Roles(ROLE.ADMIN)
  @Post(':id/rooms/allocate')
  allocate(
    @Param('id') id: string,
    @Body() dto: AllocateRoomsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomAllocationService.allocate(id, dto, actor);
  }

  /** ADMIN only — sends the room request back to the faculty with a reason. */
  @Roles(ROLE.ADMIN)
  @Post(':id/rooms/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRoomRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomAllocationService.reject(id, dto, actor);
  }
}
