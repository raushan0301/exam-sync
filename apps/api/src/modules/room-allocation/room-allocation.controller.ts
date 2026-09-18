import { Body, Controller, Param, Post } from '@nestjs/common';
import { RoomAllocationService } from './room-allocation.service';
import { AllocateRoomsDto } from './dto/allocate-rooms.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md "Room Allocation": `POST /exam-sessions/{id}/rooms/allocate` — the only endpoint documented for this phase. */
@Controller('exam-sessions')
export class RoomAllocationController {
  constructor(private readonly roomAllocationService: RoomAllocationService) {}

  @Roles(ROLE.ADMIN)
  @Post(':id/rooms/allocate')
  allocate(
    @Param('id') id: string,
    @Body() dto: AllocateRoomsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomAllocationService.allocate(id, dto, actor);
  }
}
