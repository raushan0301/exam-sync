import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RoomStatus } from '@exam-sync/db';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { UpdateSeatDto } from './dto/update-seat.dto';
import { CreateAvailabilityBlockDto } from './dto/create-availability-block.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

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

  /**
   * `GET /rooms/availability?date=YYYY-MM-DD[&room_id=...]` — new for the
   * room-availability calendar (faculty picking a room/time BEFORE
   * allocating, per-room booked time ranges; admin's read-only schedule
   * view). Reachable by both ADMIN and FACULTY. Must be registered before
   * `:id` for the same reason as `available` below.
   */
  @Roles(ROLE.ADMIN, ROLE.FACULTY)
  @Get('availability')
  getAvailability(@Query('date') date: string, @Query('room_id') roomId?: string) {
    return this.roomsService.getAvailabilityCalendar(date, roomId);
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

  @Roles(ROLE.ADMIN)
  @Get('bulk-import/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.roomsService.generateBulkImportTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="room-bulk-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @Roles(ROLE.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const job = await this.roomsService.bulkImport(file.buffer, actor);
    return { job_id: job.id };
  }
}
