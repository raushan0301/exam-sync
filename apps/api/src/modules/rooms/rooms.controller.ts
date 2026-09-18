import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RoomStatus } from '@exam-sync/db';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { UpdateSeatDto } from './dto/update-seat.dto';
import { CreateAvailabilityBlockDto } from './dto/create-availability-block.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Rooms" — `POST/GET/PATCH /rooms` incl. the
 * `/rooms/{id}/seats` sub-resource, `POST /rooms/{id}/availability-blocks`,
 * and `GET /rooms/available`. Per the user's explicit Phase 11
 * authorization decision (the docs contradict themselves: BR-047 says
 * Admin-only, API_CONTRACT.md says "ADMIN write, any read"): every GET
 * here is open to any authenticated role (no `@Roles`, same convention as
 * SubjectsController's own reads); every write is `@Roles(ROLE.ADMIN)`.
 * Explicitly NOT here: `exam_session_rooms` / room allocation — Phase 12.
 */
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Roles(ROLE.ADMIN)
  @Post()
  create(@Body() dto: CreateRoomDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomsService.create(dto, actor);
  }

  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: RoomStatus,
    @Query('building') building?: string,
    @Query('min_capacity') minCapacity?: string,
  ) {
    return this.roomsService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      building,
      minCapacity: minCapacity ? parseInt(minCapacity, 10) : undefined,
    });
  }

  /** Must be registered before `:id` — otherwise "available" would be parsed as a room id. */
  @Get('available')
  findAvailable(
    @Query('date') date: string,
    @Query('start_time') startTime: string,
    @Query('end_time') endTime: string,
    @Query('min_capacity') minCapacity?: string,
  ) {
    return this.roomsService.findAvailable({
      date,
      start_time: startTime,
      end_time: endTime,
      min_capacity: minCapacity ? parseInt(minCapacity, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roomsService.findById(id);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoomDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.roomsService.update(id, dto, actor);
  }

  @Get(':id/seats')
  listSeats(@Param('id') id: string) {
    return this.roomsService.listSeats(id);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id/seats/:seatId')
  updateSeat(
    @Param('id') id: string,
    @Param('seatId') seatId: string,
    @Body() dto: UpdateSeatDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomsService.updateSeat(id, seatId, dto, actor);
  }

  @Roles(ROLE.ADMIN)
  @Post(':id/availability-blocks')
  createAvailabilityBlock(
    @Param('id') id: string,
    @Body() dto: CreateAvailabilityBlockDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roomsService.createAvailabilityBlock(id, dto, actor);
  }

  @Get(':id/availability-blocks')
  listAvailabilityBlocks(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.roomsService.listAvailabilityBlocks(id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
