import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { RoomStatus } from '@exam-sync/db';

/**
 * `PATCH /rooms/{id}`. Deliberately does NOT accept `rows`/`columns` —
 * this phase's seat map is generated once at creation
 * (`create-room.dto.ts`'s own comment explains why resizing it isn't
 * implemented here). `status` transitions to/from `INACTIVE` are audited
 * as DEACTIVATE/REACTIVATE by the service (see rooms.service.ts).
 */
export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  building?: string;

  @IsOptional()
  @IsInt()
  floor?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  room_number?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsEnum(RoomStatus)
  status?: RoomStatus;

  @IsOptional()
  @IsObject()
  accessibility_info?: Record<string, unknown>;
}
