import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

/**
 * RoomsModule — Phase 11 (replaces the Phase 0 empty skeleton). Owns
 * `rooms`, `room_seats`, `room_availability`. No cross-module imports
 * needed — this domain is self-contained until Phase 12 (Room Allocation)
 * consumes `RoomsService`/this data from its own module.
 */
@Module({
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
