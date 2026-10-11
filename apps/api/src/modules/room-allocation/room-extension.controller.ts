import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RoomRequestStatus } from '@exam-sync/db';
import { RoomExtensionService } from './room-extension.service';
import { ApproveRoomRequestDto, CreateRoomRequestDto, RejectRoomRequestByAdminDto } from './dto/room-extension.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * "Request more rooms" during seating: the faculty member asks (the session returns to the Rooms step), an ADMIN
 * approves (rooms added, students of unfinalized rooms re-split) or declines. See `RoomExtensionService`.
 */
@Controller()
export class RoomExtensionController {
  constructor(private readonly roomExtensionService: RoomExtensionService) {}

  /** FACULTY (owner/co-instructor) — what the dialog needs: shortfall, nearest free rooms, any pending request. */
  @Roles(ROLE.FACULTY)
  @Get('exam-sessions/:id/rooms/extra')
  state(@Param('id') id: string, @Query('empty_columns') emptyColumns: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomExtensionService.state(id, actor, emptyColumns === undefined ? undefined : emptyColumns === 'true');
  }

  @Roles(ROLE.FACULTY)
  @Post('exam-sessions/:id/room-requests')
  create(@Param('id') id: string, @Body() dto: CreateRoomRequestDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomExtensionService.create(id, dto, actor);
  }

  /** ADMIN sees every request, FACULTY their own. */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('room-requests')
  list(
    @Query('status') status: RoomRequestStatus | undefined,
    @Query('exam_session_id') examSessionId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomExtensionService.list(actor, {
      status: status && Object.values(RoomRequestStatus).includes(status) ? status : undefined,
      examSessionId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('room-requests/:id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomExtensionService.get(id, actor);
  }

  @Roles(ROLE.FACULTY, ROLE.ADMIN)
  @Post('room-requests/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomExtensionService.cancel(id, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post('room-requests/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveRoomRequestDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomExtensionService.approve(id, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post('room-requests/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectRoomRequestByAdminDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomExtensionService.reject(id, dto, actor);
  }
}
