import { Global, Module } from '@nestjs/common';
import { RoomHoldsService } from './room-holds.service';

/** Global so quiz approval, room allocation, suggestions and session cancel can all use it without import cycles. */
@Global()
@Module({
  providers: [RoomHoldsService],
  exports: [RoomHoldsService],
})
export class RoomHoldsModule {}
